# Running The Flutter App

This project is a Flutter mobile app. Expo Go is not applicable because this project is Flutter, not React Native/Expo.

If Android and iOS platform folders are missing after cloning, run this once from the project root after installing Flutter:

```bash
flutter create . --project-name nutrition_plan_app --platforms=android,ios
```

Then run:

```bash
flutter pub get
```

## Android Physical Device

1. Install the Flutter SDK.
2. Install Android Studio or Android SDK command-line tools.
3. Enable Developer Options on the Android phone.
4. Enable USB debugging.
5. Connect the phone by USB.
6. From the project root, run:

```bash
flutter doctor
flutter devices
flutter pub get
flutter run
```

## Android Emulator

1. Install Android Studio.
2. Open Device Manager.
3. Create an Android emulator.
4. Start the emulator.
5. From the project root, run:

```bash
flutter devices
flutter run
```

## iOS Simulator

iOS simulator testing requires macOS and Xcode.

```bash
open -a Simulator
flutter devices
flutter run
```

## iPhone Physical Device

Running on a physical iPhone requires macOS, Xcode, an Apple developer account or signing setup, and a trusted connected iPhone.

Typical flow:

```bash
flutter doctor
flutter devices
flutter pub get
flutter run
```

If signing fails, open the generated iOS project in Xcode and configure the Runner target's Team and Bundle Identifier.

## Verification Notes

Use `flutter doctor` first. It will show any missing Android SDK, Xcode, CocoaPods, or connected-device setup that must be fixed before `flutter run` can succeed.
