suppressPackageStartupMessages(library(grf))

set.seed(7100)
clusters <- rep(seq_len(30), each = 4)
W <- rep(rep(c(0, 1), each = 4), 15)
X <- cbind(x1 = rnorm(length(W)), x2 = rep(c(0, 1), length.out = length(W)))
Y <- -2 * W + X[, "x1"] + rnorm(length(W))

forest <- causal_forest(
  X,
  Y,
  W,
  W.hat = rep(0.5, length(W)),
  clusters = clusters,
  equalize.cluster.weights = FALSE,
  num.trees = 100,
  honesty = TRUE,
  tune.parameters = "none",
  num.threads = 1,
  seed = 7100
)
prediction <- predict(forest, X[1:4, , drop = FALSE], num.threads = 1)$predictions
stopifnot(length(prediction) == 4, all(is.finite(prediction)))
cat("grf clustered fit/predict smoke PASS\n")
