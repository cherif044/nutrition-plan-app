import 'package:flutter/material.dart';

import '../../domain/models/user_input.dart';

class GoalSelector extends StatelessWidget {
  const GoalSelector({
    required this.value,
    required this.onChanged,
    super.key,
  });

  final Goal value;
  final ValueChanged<Goal> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<Goal>(
      segments: Goal.values
          .map(
            (goal) => ButtonSegment<Goal>(
              value: goal,
              label: Text(goal.label),
            ),
          )
          .toList(growable: false),
      selected: {value},
      showSelectedIcon: false,
      onSelectionChanged: (selection) => onChanged(selection.first),
    );
  }
}
