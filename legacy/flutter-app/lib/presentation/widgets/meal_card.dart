import 'package:flutter/material.dart';

import '../../core/utils/number_rounding.dart';
import '../../domain/models/meal.dart';
import 'food_item_tile.dart';
import 'glass_card.dart';

class MealCard extends StatelessWidget {
  const MealCard({
    required this.meal,
    super.key,
  });

  final Meal meal;

  @override
  Widget build(BuildContext context) {
    final totals = meal.totals;
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  meal.name,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ),
              if (meal.isApproximate)
                const Tooltip(
                  message: 'Closest available match within current foods',
                  child: Icon(Icons.info_outline_rounded, size: 20),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Target ${formatNumber(meal.target.calories)} kcal · '
            'Actual ${formatNumber(totals.calories)} kcal',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 4),
          Text(
            'P ${formatNumber(totals.proteinG)}g · '
            'C ${formatNumber(totals.carbG)}g · '
            'F ${formatNumber(totals.fatG)}g',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const Divider(height: 24),
          ...meal.items.map((item) => FoodItemTile(item: item)),
        ],
      ),
    );
  }
}
