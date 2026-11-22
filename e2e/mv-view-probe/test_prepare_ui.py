import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('prepare_ui', Path(__file__).with_name('prepare_ui.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def dialog(title, package='android', bounds='[100,200][300,400]'):
    return f'''<hierarchy><node package="android" text="{title}"/>
    <node package="{package}" resource-id="android:id/aerr_close" bounds="{bounds}"/>
    </hierarchy>'''


class PreflightTest(unittest.TestCase):
    def test_exact_launcher_dialog(self):
        for title in ["Pixel Launcher isn't responding", 'Pixel Launcher isn’t responding',
                      'Pixel Launcher is not responding']:
            self.assertEqual(module.inspect(dialog(title)), (200, 300))

    def test_app_or_unknown_anr_must_fail(self):
        for title in ["MusicFree isn't responding", "System UI isn't responding", 'Pixel Launcher crashed']:
            with self.assertRaises(AssertionError):
                module.inspect(dialog(title))

    def test_no_other_package_may_supply_close_button(self):
        with self.assertRaises(AssertionError):
            module.inspect(dialog("Pixel Launcher isn't responding", package=module.PACKAGE))

    def test_invalid_or_empty_bounds_fail(self):
        for bounds in ['', '[0,0][0,0]', '[300,200][100,400]']:
            with self.assertRaises(AssertionError):
                module.inspect(dialog("Pixel Launcher isn't responding", bounds=bounds))

    def test_foreground_app_without_dialog(self):
        self.assertIsNone(module.inspect(f'<hierarchy><node package="{module.PACKAGE}"/></hierarchy>'))

    def test_other_foreground_window_fails(self):
        with self.assertRaises(AssertionError):
            module.inspect('<hierarchy><node package="com.google.android.apps.nexuslauncher"/></hierarchy>')


if __name__ == '__main__':
    unittest.main()
