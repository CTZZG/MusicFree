// Jest 里没有原生模块：后台定时器退化成普通定时器，测试的假定时器同样能接管。
const BackgroundTimer = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => clearTimeout(id),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: id => clearInterval(id),
    runBackgroundTimer() {},
    stopBackgroundTimer() {},
    start() {},
    stop() {},
};

module.exports = BackgroundTimer;
module.exports.default = BackgroundTimer;
module.exports.__esModule = true;
