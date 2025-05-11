import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export function getAppUserAgent(): string {
    const appName = DeviceInfo.getApplicationName();
    const appVersion = DeviceInfo.getVersion();
    const platformOS = Platform.OS === 'android' ? 'Android' : 'iOS';
    if (Platform.OS === 'android') {
        const osVersion = Platform.Version;
        const deviceModel = DeviceInfo.getModel();
        return `Mozilla/5.0 (Linux; Android ${osVersion}; ${deviceModel}; rv:112.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 ${appName}/${appVersion}`;
    } else if (Platform.OS === 'ios') {
        const osVersion = Platform.Version.toString().replace('.', '_');
        return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${appName}/${appVersion}`;
    }
    return `${appName}/${appVersion}`;
}
