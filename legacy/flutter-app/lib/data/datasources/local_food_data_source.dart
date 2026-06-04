import 'dart:convert';

import 'package:flutter/services.dart';

import '../../core/errors/app_exception.dart';
import '../../domain/models/food.dart';

class LocalFoodDataSource {
  LocalFoodDataSource({
    this.assetPath = 'assets/data/foods.json',
  });

  final String assetPath;
  List<Food>? _cache;

  Future<List<Food>> loadFoods() async {
    if (_cache != null) {
      return _cache!;
    }

    final rawJson = await rootBundle.loadString(assetPath);
    final decoded = jsonDecode(rawJson);

    if (decoded is! List) {
      throw const AppException('Food data must be a JSON array.');
    }

    final foods = decoded.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const AppException('Each food item must be a JSON object.');
      }
      return Food.fromJson(item);
    }).toList(growable: false);

    if (foods.isEmpty) {
      throw const AppException('Food data is empty.');
    }

    _cache = foods;
    return foods;
  }
}
