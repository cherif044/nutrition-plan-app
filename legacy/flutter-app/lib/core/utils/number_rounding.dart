double roundToNearest(double value, double step) {
  if (step <= 0) {
    return value;
  }
  return (value / step).round() * step;
}

double clampDouble(double value, double min, double max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

String formatNumber(double value, {int decimals = 0}) {
  return value.toStringAsFixed(decimals);
}
