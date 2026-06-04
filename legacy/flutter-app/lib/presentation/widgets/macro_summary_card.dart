import 'package:flutter/material.dart';

import '../../core/utils/number_rounding.dart';
import '../../domain/models/generated_plan.dart';
import 'glass_card.dart';

class MacroSummaryCard extends StatelessWidget {
  const MacroSummaryCard({
    required this.plan,
    super.key,
  });

  final GeneratedPlan plan;

  @override
  Widget build(BuildContext context) {
    final targets = plan.dailyTargets;
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Daily targets', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          Row(
            children: [
              _Metric(
                label: 'Calories',
                value: formatNumber(targets.calories),
                unit: 'kcal',
              ),
              _Metric(
                label: 'Protein',
                value: formatNumber(targets.proteinG),
                unit: 'g',
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _Metric(
                label: 'Carbs',
                value: formatNumber(targets.carbG),
                unit: 'g',
              ),
              _Metric(
                label: 'Fat',
                value: formatNumber(targets.fatG),
                unit: 'g',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.unit,
  });

  final String label;
  final String value;
  final String unit;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.58),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.black.withValues(alpha: 0.04)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            RichText(
              text: TextSpan(
                style: Theme.of(context).textTheme.headlineMedium,
                children: [
                  TextSpan(text: value),
                  TextSpan(
                    text: ' $unit',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
