suppressPackageStartupMessages(library(grf))

fail <- function(message) stop(message, call. = FALSE)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4L) {
  fail("usage: hte_rate_validation.R <validation_input.csv> <rate.csv> <paired.csv> <toc.csv>")
}

data <- read.csv(args[[1]], check.names = FALSE)
required <- c(
  "ID", "village_id", "fold", "W", "delta_risk", "gamma_tau", "gamma_benefit",
  "benefit_hat_grf", "benefit_hat_simple_oov", "risk0", "random_priority_raw",
  "priority_grf_within_fold", "priority_simple_within_fold",
  "priority_risk_within_fold", "priority_random_within_fold"
)
missing <- setdiff(required, names(data))
if (length(missing)) fail(paste("validation input missing columns:", paste(missing, collapse = ", ")))
if (nrow(data) != 4508L || anyDuplicated(data$ID)) fail("validation input must contain 4508 unique participants")
if (length(unique(data$village_id)) != 127L) fail("validation input must contain 127 villages")
if (!identical(sort(unique(data$fold)), 1:5)) fail("validation input must preserve folds 1 through 5")
if (any(!is.finite(as.matrix(data[required])))) fail("validation input contains non-finite values")
if (!all(data$gamma_benefit == -data$gamma_tau)) fail("gamma_benefit must equal negative gamma_tau")
if (!all(data$W %in% c(0, 1))) fail("W must remain binary")
if (any(tapply(data$fold, data$village_id, function(x) length(unique(x))) != 1L)) fail("village split across folds")

orientation <- list(
  grf = c("benefit_hat_grf", "priority_grf_within_fold"),
  simple = c("benefit_hat_simple_oov", "priority_simple_within_fold"),
  baseline_risk = c("risk0", "priority_risk_within_fold"),
  random = c("random_priority_raw", "priority_random_within_fold")
)
for (rule in names(orientation)) {
  columns <- orientation[[rule]]
  orientation_valid <- sapply(split(data, data$fold), function(part) {
    ordered <- order(part[[columns[[1]]]], part$ID)
    all(diff(part[[columns[[2]]]][ordered]) >= 0)
  })
  if (!all(orientation_valid)) fail(paste("priority orientation invalid for", rule))
}

q_grid <- seq(0.1, 1.0, by = 0.1)
bootstrap_replicates <- 1000L
fit_rate <- function(priorities, target, seed) {
  set.seed(seed)
  rank_average_treatment_effect.fit(
    DR.scores = data$gamma_benefit,
    priorities = priorities,
    target = target,
    q = q_grid,
    R = bootstrap_replicates,
    sample.weights = NULL,
    clusters = data$village_id
  )
}

rate_rows <- list()
toc_rows <- list()
paired_rows <- list()

add_rate <- function(fit, rules, normalization, target) {
  for (index in seq_along(rules)) {
    estimate <- fit$estimate[[index]]
    std.error <- fit$std.err[[index]]
    rate_rows[[length(rate_rows) + 1L]] <<- data.frame(
      rule = rules[[index]],
      normalization = normalization,
      target = target,
      estimate = estimate,
      std_error = std.error,
      ci_low = estimate - 1.96 * std.error,
      ci_high = estimate + 1.96 * std.error,
      bootstrap_replicates = bootstrap_replicates,
      clusters = 127L,
      participant_weighting = TRUE
    )
  }
}

add_toc <- function(fit, rule_map) {
  for (priority_name in names(rule_map)) {
    part <- fit$TOC[fit$TOC$priority == priority_name, , drop = FALSE]
    toc_rows[[length(toc_rows) + 1L]] <<- data.frame(
      rule = rule_map[[priority_name]],
      normalization = "within_fold",
      target = "AUTOC",
      q = part$q,
      estimate = part$estimate,
      std_error = part$std.err,
      ci_low = part$estimate - 1.96 * part$std.err,
      ci_high = part$estimate + 1.96 * part$std.err
    )
  }
}

add_pair <- function(fit, comparison, first_rule, second_rule) {
  estimate <- fit$estimate[[3]]
  std.error <- fit$std.err[[3]]
  paired_rows[[length(paired_rows) + 1L]] <<- data.frame(
    comparison = comparison,
    first_rule = first_rule,
    second_rule = second_rule,
    estimate_difference = estimate,
    std_error = std.error,
    ci_low = estimate - 1.96 * std.error,
    ci_high = estimate + 1.96 * std.error,
    direction = paste(first_rule, "minus", second_rule),
    bootstrap_replicates = bootstrap_replicates,
    clusters = 127L
  )
}

primary_grf_simple <- fit_rate(
  data.frame(grf = data$priority_grf_within_fold, simple = data$priority_simple_within_fold),
  "AUTOC", 8201L
)
add_rate(primary_grf_simple, c("grf", "simple"), "within_fold", "AUTOC")
add_toc(primary_grf_simple, c(grf = "grf", simple = "simple"))
add_pair(primary_grf_simple, "grf_minus_simple", "grf", "simple")

primary_grf_risk <- fit_rate(
  data.frame(grf = data$priority_grf_within_fold, baseline_risk = data$priority_risk_within_fold),
  "AUTOC", 8202L
)
add_rate(primary_grf_risk, c("grf", "baseline_risk"), "within_fold_duplicate", "AUTOC")
add_toc(primary_grf_risk, c(baseline_risk = "baseline_risk"))
add_pair(primary_grf_risk, "grf_minus_baseline_risk", "grf", "baseline_risk")

primary_simple_risk <- fit_rate(
  data.frame(simple = data$priority_simple_within_fold, baseline_risk = data$priority_risk_within_fold),
  "AUTOC", 8203L
)
add_pair(primary_simple_risk, "simple_minus_baseline_risk", "simple", "baseline_risk")

primary_random <- fit_rate(data.frame(random = data$priority_random_within_fold), "AUTOC", 8204L)
add_rate(primary_random, "random", "within_fold", "AUTOC")
add_toc(primary_random, c(random = "random"))

qini_grf_simple <- fit_rate(
  data.frame(grf = data$priority_grf_within_fold, simple = data$priority_simple_within_fold),
  "QINI", 8211L
)
add_rate(qini_grf_simple, c("grf", "simple"), "within_fold", "QINI")
qini_risk_random <- fit_rate(
  data.frame(baseline_risk = data$priority_risk_within_fold, random = data$priority_random_within_fold),
  "QINI", 8212L
)
add_rate(qini_risk_random, c("baseline_risk", "random"), "within_fold", "QINI")

raw_grf_simple <- fit_rate(
  data.frame(grf = data$benefit_hat_grf, simple = data$benefit_hat_simple_oov),
  "AUTOC", 8221L
)
add_rate(raw_grf_simple, c("grf", "simple"), "raw", "AUTOC")
raw_grf_risk <- fit_rate(
  data.frame(grf = data$benefit_hat_grf, baseline_risk = data$risk0),
  "AUTOC", 8222L
)
add_rate(raw_grf_risk, c("grf", "baseline_risk"), "raw_duplicate", "AUTOC")

rate <- do.call(rbind, rate_rows)
rate <- rate[!(rate$normalization == "within_fold_duplicate" & rate$rule == "grf"), ]
rate$normalization[rate$normalization == "within_fold_duplicate"] <- "within_fold"
rate <- rate[!(rate$normalization == "raw_duplicate" & rate$rule == "grf"), ]
rate$normalization[rate$normalization == "raw_duplicate"] <- "raw"
paired <- do.call(rbind, paired_rows)
toc <- do.call(rbind, toc_rows)
if (!identical(sort(unique(rate$rule[rate$normalization == "within_fold" & rate$target == "AUTOC"])),
               sort(c("grf", "simple", "baseline_risk", "random")))) {
  fail("primary AUTOC output does not cover all four rules")
}
if (nrow(paired) != 3L || nrow(toc) != 40L) fail("RATE aggregate output is incomplete")
write.csv(rate, args[[2]], row.names = FALSE, quote = FALSE)
write.csv(paired, args[[3]], row.names = FALSE, quote = FALSE)
write.csv(toc, args[[4]], row.names = FALSE, quote = FALSE)
cat(sprintf("Phase-8 RATE integration PASS: N=%d clusters=%d R=%d\n", nrow(data), 127L, bootstrap_replicates))
