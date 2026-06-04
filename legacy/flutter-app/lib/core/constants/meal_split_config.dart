class MealSplitConfig {
  const MealSplitConfig._();

  static const Map<int, List<double>> mealSplits = {
    2: [0.5, 0.5],
    3: [0.3, 0.4, 0.3],
    4: [0.25, 0.25, 0.25, 0.25],
    5: [0.2, 0.25, 0.25, 0.2, 0.1],
  };

  static const Map<int, double> snackTotalSplits = {
    0: 0,
    1: 0.10,
    2: 0.15,
  };

  static const List<double> ramadanSplits = [0.5, 0.2, 0.3];
  static const List<String> ramadanNames = ['Iftar', 'Snack', 'Suhoor'];
  static const List<String> ramadanTags = ['iftar', 'snack', 'suhoor'];
}
