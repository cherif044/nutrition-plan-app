import 'package:flutter/material.dart';

import '../../domain/models/user_input.dart';
import 'input_section.dart';

class PreferencesSection extends StatelessWidget {
  const PreferencesSection({
    required this.dietType,
    required this.onDietTypeChanged,
    required this.allergiesController,
    required this.dislikesController,
    required this.milkTypeController,
    required this.coffeesController,
    required this.ramadanMode,
    required this.onRamadanModeChanged,
    super.key,
  });

  final DietType dietType;
  final ValueChanged<DietType> onDietTypeChanged;
  final TextEditingController allergiesController;
  final TextEditingController dislikesController;
  final TextEditingController milkTypeController;
  final TextEditingController coffeesController;
  final bool ramadanMode;
  final ValueChanged<bool> onRamadanModeChanged;

  @override
  Widget build(BuildContext context) {
    return InputSection(
      title: 'Preferences',
      children: [
        DropdownButtonFormField<DietType>(
          initialValue: dietType,
          decoration: const InputDecoration(labelText: 'Diet type'),
          items: DietType.values
              .map(
                (diet) => DropdownMenuItem(
                  value: diet,
                  child: Text(diet.label),
                ),
              )
              .toList(growable: false),
          onChanged: (value) {
            if (value != null) {
              onDietTypeChanged(value);
            }
          },
        ),
        const SizedBox(height: 12),
        TextField(
          controller: allergiesController,
          decoration: const InputDecoration(
            labelText: 'Allergies',
            hintText: 'lactose, nuts, gluten',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: dislikesController,
          decoration: const InputDecoration(
            labelText: 'Dislikes',
            hintText: 'tuna, oats',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: milkTypeController,
          decoration: const InputDecoration(labelText: 'Milk type'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: coffeesController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Coffees per day'),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          value: ramadanMode,
          onChanged: onRamadanModeChanged,
          title: const Text('Ramadan split'),
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
