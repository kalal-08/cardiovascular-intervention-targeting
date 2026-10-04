suppressPackageStartupMessages(library(grf))

fail <- function(message) stop(message, call. = FALSE)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) {
  fail("usage: grf_crossfit.R <model_matrix.csv> <feature_manifest.csv> <predictions.csv> <metadata.csv>")
}

matrix_path <- args[[1]]
manifest_path <- args[[2]]
prediction_path <- args[[3]]
metadata_path <- args[[4]]

data <- read.csv(matrix_path, check.names = FALSE)
manifest <- read.csv(manifest_path, check.names = FALSE)
features <- manifest$feature[manifest$included_in_grf == 1]

required <- c("ID", "village_id", "fold", "W", "outcome_observed", "delta_risk", features)
missing <- setdiff(required, names(data))
if (length(missing)) fail(paste("model matrix missing columns:", paste(missing, collapse = ", ")))
if (nrow(data) != 4533L || length(unique(data$ID)) != 4533L) fail("model matrix must contain 4533 unique participants")
if (length(unique(data$village_id)) != 127L) fail("model matrix must contain 127 villages")
if (!identical(sort(unique(data$fold)), 1:5)) fail("model matrix must contain folds 1 through 5")
if (!all(data$W %in% c(0, 1))) fail("W must be binary 0/1")
if (anyDuplicated(data$ID)) fail("duplicate participant ID")
if (any(vapply(data[features], function(column) !is.numeric(column), logical(1)))) fail("all X columns must be numeric")
if (any(!is.finite(as.matrix(data[features])))) fail("X contains missing or non-finite values")
if (!all(data$outcome_observed %in% c(0, 1))) fail("outcome_observed must be binary 0/1")
observed <- data$outcome_observed == 1
if (sum(observed) != 4508L) fail("outcome-observed count must equal 4508")
if (any(is.na(data$delta_risk[observed]))) fail("training-eligible rows require delta_risk")
if (any(!is.na(data$delta_risk[!observed]))) fail("missing outcomes cannot be fabricated")
if (any(tapply(data$fold, data$village_id, function(x) length(unique(x))) != 1L)) fail("village split across folds")

prediction_rows <- vector("list", 5L)
audit_rows <- vector("list", 5L)
for (heldout_fold in 1:5) {
  train <- data[data$fold != heldout_fold & observed, , drop = FALSE]
  heldout <- data[data$fold == heldout_fold, , drop = FALSE]
  train_villages <- unique(train$village_id)
  heldout_villages <- unique(heldout$village_id)
  overlap <- intersect(train_villages, heldout_villages)
  if (length(overlap)) fail(paste("village leakage in fold", heldout_fold))
  if (length(unique(train$W)) != 2L || length(unique(heldout$W)) != 2L) fail(paste("single-arm fold", heldout_fold))

  seed <- 7300L + heldout_fold
  forest <- causal_forest(
    as.matrix(train[features]),
    train$delta_risk,
    train$W,
    W.hat = rep(0.5, nrow(train)),
    clusters = train$village_id,
    equalize.cluster.weights = FALSE,
    num.trees = 2000,
    honesty = TRUE,
    tune.parameters = "none",
    num.threads = 1,
    seed = seed
  )
  tau <- predict(forest, as.matrix(heldout[features]), num.threads = 1)$predictions
  if (length(tau) != nrow(heldout) || any(!is.finite(tau))) fail(paste("invalid predictions in fold", heldout_fold))
  prediction_rows[[heldout_fold]] <- data.frame(
    ID = heldout$ID,
    village_id = heldout$village_id,
    fold = heldout$fold,
    model_fold = heldout_fold,
    tau_hat_grf = tau,
    benefit_hat_grf = -tau,
    training_village_count = length(train_villages),
    model_specification_id = "grf_clustered_oov_v1",
    seed = seed
  )
  audit_rows[[heldout_fold]] <- data.frame(
    fold = heldout_fold,
    training_rows = nrow(train),
    training_villages = length(train_villages),
    heldout_villages = length(heldout_villages),
    heldout_prediction_rows = nrow(heldout),
    village_overlap = length(overlap)
  )
}

predictions <- do.call(rbind, prediction_rows)
predictions <- predictions[order(predictions$ID), ]
if (nrow(predictions) != 4533L || anyDuplicated(predictions$ID)) fail("incomplete or duplicate OOV predictions")
write.csv(predictions, prediction_path, row.names = FALSE, quote = FALSE, na = "")

audit <- do.call(rbind, audit_rows)
metadata <- data.frame(
  r_version = R.version.string,
  grf_version = as.character(packageVersion("grf")),
  fold_count = 5L,
  feature_count = length(features),
  num_trees = 2000L,
  W_hat = 0.5,
  clusters = "village_id",
  equalize_cluster_weights = FALSE,
  honesty = TRUE,
  tuning = "none",
  num_threads = 1L,
  seed_policy = "7300 + heldout fold",
  prediction_count = nrow(predictions),
  evaluation_eligible_count = sum(observed),
  max_village_overlap = max(audit$village_overlap)
)
write.csv(metadata, metadata_path, row.names = FALSE, quote = FALSE, na = "")
cat(sprintf("GRF OOV cross-fit PASS: predictions=%d folds=%d features=%d\n", nrow(predictions), 5L, length(features)))
