import 'package:flutter/material.dart';

import '../../core/utils/number_rounding.dart';
import '../../domain/models/meal_item.dart';

class FoodItemTile extends StatelessWidget {
  const FoodItemTile({
    required this.item,
    super.key,
  });

  final MealItem item;

  @override
  Widget build(BuildContext context) {
    final totals = item.totals;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.food.name,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (item.food.nameAr.isNotEmpty)
                      Text(
                        item.food.nameAr,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                  ],
                ),
              ),
              Text(
                '${formatNumber(item.quantityG)}g',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${formatNumber(totals.calories)} kcal · '
            'P ${formatNumber(totals.proteinG)}g · '
            'C ${formatNumber(totals.carbG)}g · '
            'F ${formatNumber(totals.fatG)}g',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (item.alternatives.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: item.alternatives
                  .map(
                    (food) => Chip(
                      label:
                          Text('${formatNumber(item.quantityG)}g ${food.name}'),
                      visualDensity: VisualDensity.compact,
                    ),
                  )
                  .toList(growable: false),
            ),
          ],
        ],
      ),
    );
  }
}
