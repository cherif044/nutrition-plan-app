import 'package:flutter/material.dart';

import 'core/constants/app_theme.dart';
import 'presentation/screens/home_screen.dart';

class NutritionPlanApp extends StatelessWidget {
  const NutritionPlanApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nutrition Plan',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: const HomeScreen(),
    );
  }
}
