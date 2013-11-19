var Fs = require("fs");

var runners = {};
var runnersPath = __dirname + "/runners/";
Fs.readdirSync(runnersPath).forEach(function (name) {
    var json = JSON.parse(Fs.readFileSync(runnersPath + name));
    runners[json.caption || name] = json;
});

module.exports = runners;
