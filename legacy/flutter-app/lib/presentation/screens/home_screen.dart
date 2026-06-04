import 'package:flutter/material.dart';

import '../../data/datasources/local_food_data_source.dart';
import '../../data/repositories/food_repository_impl.dart';
import '../../domain/models/generated_plan.dart';
import '../../domain/models/user_input.dart';
import '../../domain/services/food_swap_service.dart';
import '../../domain/services/meal_splitter.dart';
import '../../domain/services/nutrition_calculator.dart';
import '../../domain/services/plan_generator.dart';
import '../widgets/generate_button.dart';
import '../widgets/goal_selector.dart';
import '../widgets/input_section.dart';
import '../widgets/macro_summary_card.dart';
import '../widgets/meal_card.dart';
import '../widgets/preferences_section.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final PlanGenerator _planGenerator;

  final _weightController = TextEditingController(text: '80');
  final _heightController = TextEditingController(text: '175');
  final _bodyFatController = TextEditingController(text: '20');
  final _allergiesController = TextEditingController();
  final _dislikesController = TextEditingController();
  final _milkTypeController = TextEditingController(text: 'skimmed');
  final _coffeesController = TextEditingController(text: '1');

  ActivityLevel _activityLevel = ActivityLevel.moderate;
  Goal _goal = Goal.maintain;
  DietType _dietType = DietType.standard;
  int _numberOfMeals = 3;
  int _numberOfSnacks = 1;
  bool _ramadanMode = false;
  bool _isLoading = false;
  GeneratedPlan? _plan;

  @override
  void initState() {
    super.initState();
    _planGenerator = PlanGenerator(
      foodRepository: FoodRepositoryImpl(LocalFoodDataSource()),
      nutritionCalculator: NutritionCalculator(),
      mealSplitter: MealSplitter(),
      foodSwapService: FoodSwapService(),
    );
  }

  @override
  void dispose() {
    _weightController.dispose();
    _heightController.dispose();
    _bodyFatController.dispose();
    _allergiesController.dispose();
    _dislikesController.dispose();
    _milkTypeController.dispose();
    _coffeesController.dispose();
    super.dispose();
  }

  Future<void> _generatePlan() async {
    final input = _readInput();
    if (input == null) {
      return;
    }

    setState(() => _isLoading = true);
    try {
      final plan = await _planGenerator.generate(input);
      if (!mounted) {
        return;
      }
      setState(() => _plan = plan);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  UserInput? _readInput() {
    final weight = double.tryParse(_weightController.text.trim());
    final height = double.tryParse(_heightController.text.trim());
    final bodyFatText = _bodyFatController.text.trim();
    final bodyFat = bodyFatText.isEmpty ? null : double.tryParse(bodyFatText);
    final coffees = int.tryParse(_coffeesController.text.trim()) ?? 0;

    if (weight == null || weight <= 0) {
      _showValidation('Enter a valid weight.');
      return null;
    }
    if (height == null || height <= 0) {
      _showValidation('Enter a valid height.');
      return null;
    }
    if (bodyFatText.isNotEmpty &&
        (bodyFat == null || bodyFat <= 0 || bodyFat >= 70)) {
      _showValidation('Body fat should be between 1 and 69%.');
      return null;
    }

    return UserInput(
      weightKg: weight,
      heightCm: height,
      bodyFatPercentage: bodyFat,
      activityLevel: _activityLevel,
      goal: _goal,
      numberOfMeals: _numberOfMeals,
      numberOfSnacks: _numberOfSnacks,
      dietType: _dietType,
      allergies: _splitCsv(_allergiesController.text),
      dislikes: _splitCsv(_dislikesController.text),
      milkType: _milkTypeController.text.trim(),
      coffeesPerDay: coffees,
      ramadanMode: _ramadanMode,
    );
  }

  List<String> _splitCsv(String value) {
    return value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }

  void _showValidation(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          color: Color(0xFFF5F7F8),
        ),
        child: SafeArea(
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 22, 18, 10),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 760),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Nutrition Plan',
                          style: Theme.of(context).textTheme.headlineLarge,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Local food data, precise targets, practical portions.',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
                sliver: SliverToBoxAdapter(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 760),
                      child: Column(
                        children: [
                          _bodySection(),
                          const SizedBox(height: 14),
                          _planSection(),
                          const SizedBox(height: 14),
                          PreferencesSection(
                            dietType: _dietType,
                            onDietTypeChanged: (value) {
                              setState(() => _dietType = value);
                            },
                            allergiesController: _allergiesController,
                            dislikesController: _dislikesController,
                            milkTypeController: _milkTypeController,
                            coffeesController: _coffeesController,
                            ramadanMode: _ramadanMode,
                            onRamadanModeChanged: (value) {
                              setState(() => _ramadanMode = value);
                            },
                          ),
                          const SizedBox(height: 16),
                          GenerateButton(
                            isLoading: _isLoading,
                            onPressed: _generatePlan,
                          ),
                          if (_plan != null) ...[
                            const SizedBox(height: 22),
                            MacroSummaryCard(plan: _plan!),
                            const SizedBox(height: 14),
                            ..._plan!.meals.expand(
                              (meal) => [
                                MealCard(meal: meal),
                                const SizedBox(height: 14),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bodySection() {
    return InputSection(
      title: 'Body data',
      children: [
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: _weightController,
                label: 'Weight kg',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: _heightController,
                label: 'Height cm',
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _numberField(
          controller: _bodyFatController,
          label: 'Body fat %',
          optional: true,
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<ActivityLevel>(
          initialValue: _activityLevel,
          decoration: const InputDecoration(labelText: 'Activity level'),
          items: ActivityLevel.values
              .map(
                (level) => DropdownMenuItem(
                  value: level,
                  child: Text(level.label),
                ),
              )
              .toList(growable: false),
          onChanged: (value) {
            if (value != null) {
              setState(() => _activityLevel = value);
            }
          },
        ),
      ],
    );
  }

  Widget _planSection() {
    return InputSection(
      title: 'Plan setup',
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: GoalSelector(
            value: _goal,
            onChanged: (value) => setState(() => _goal = value),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: _numberOfMeals,
                decoration: const InputDecoration(labelText: 'Meals'),
                items: [2, 3, 4, 5]
                    .map(
                      (count) => DropdownMenuItem(
                        value: count,
                        child: Text('$count meals'),
                      ),
                    )
                    .toList(growable: false),
                onChanged: _ramadanMode
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _numberOfMeals = value);
                        }
                      },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: _numberOfSnacks,
                decoration: const InputDecoration(labelText: 'Snacks'),
                items: [0, 1, 2]
                    .map(
                      (count) => DropdownMenuItem(
                        value: count,
                        child: Text('$count snacks'),
                      ),
                    )
                    .toList(growable: false),
                onChanged: _ramadanMode
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _numberOfSnacks = value);
                        }
                      },
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _numberField({
    required TextEditingController controller,
    required String label,
    bool optional = false,
  }) {
    return TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        labelText: label,
        suffixText: optional ? 'optional' : null,
      ),
    );
  }
}
