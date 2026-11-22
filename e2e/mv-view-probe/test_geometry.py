import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('view_capture', Path(__file__).with_name('capture.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RECT = {'x': 16, 'y': 298.666687, 'width': 379.428558, 'height': 213.333313, 'density': 2.625}


def box(bounds='[42,920][1038,1480]', package='fun.upup.musicfree.mvprobe'):
    return f'<node package="{package}" bounds="{bounds}"><node package="{package}" text="MV"/></node>'


class GeometryTest(unittest.TestCase):
    def test_android_bounds_not_window_offset(self):
        self.assertEqual(module.screen_rect('<hierarchy>' + box() + '</hierarchy>', RECT), (42, 920, 996, 560))
        self.assertNotEqual(round(RECT['y'] * RECT['density']), 920)

    def test_no_magic_vertical_offset(self):
        self.assertEqual(module.screen_rect('<hierarchy>' + box('[42,200][1038,760]') + '</hierarchy>', RECT), (42, 200, 996, 560))

    def test_nested_identical_native_bounds(self):
        xml = '<hierarchy><node package="fun.upup.musicfree.mvprobe" bounds="[42,920][1038,1480]">' + box() + '</node></hierarchy>'
        self.assertEqual(module.screen_rect(xml, RECT), (42, 920, 996, 560))

    def test_wrong_app_or_size_rejected(self):
        for xml in [box(package='other.app'), box('[42,920][1038,1300]')]:
            with self.assertRaises(AssertionError):
                module.screen_rect('<hierarchy>' + xml + '</hierarchy>', RECT)

    def test_ambiguous_containers_rejected(self):
        with self.assertRaises(AssertionError):
            module.screen_rect('<hierarchy>' + box() + box('[42,200][1038,760]') + '</hierarchy>', RECT)

    def test_overlay_uses_label_screen_bounds(self):
        xml = '<hierarchy><node package="fun.upup.musicfree.mvprobe" text="MV" bounds="[930,973][986,1024]"/></hierarchy>'
        self.assertEqual(module.overlay_rect(xml, (42, 920, 996, 560)), (888, 53, 944, 104))

    def test_fixture_yellow_outside_overlay_cannot_pass(self):
        raw = bytearray(bytes((0, 255, 255)) * 400)
        raw[:120] = bytes((255, 255, 0)) * 40
        with self.assertRaises(AssertionError):
            module.check_overlay(raw, 20, (10, 10, 20, 20))
        for row in range(10, 20):
            start = (row * 20 + 10) * 3
            raw[start:start+30] = bytes((255, 255, 0)) * 10
        module.check_overlay(raw, 20, (10, 10, 20, 20))


if __name__ == '__main__':
    unittest.main()
