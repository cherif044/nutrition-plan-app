import '../models/food.dart';

abstract class FoodRepository {
  Future<List<Food>> getAllFoods();
}
