import '../../domain/models/food.dart';
import '../../domain/repositories/food_repository.dart';
import '../datasources/local_food_data_source.dart';

class FoodRepositoryImpl implements FoodRepository {
  FoodRepositoryImpl(this._dataSource);

  final LocalFoodDataSource _dataSource;

  @override
  Future<List<Food>> getAllFoods() {
    return _dataSource.loadFoods();
  }
}
