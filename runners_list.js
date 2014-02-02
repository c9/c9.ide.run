var Fs = require("fs");

var runners = {};
var runnersPath = __dirname + "/runners/";
Fs.readdirSync(runnersPath).forEach(function (name) {
    var json = JSON.parse(Fs.readFileSync(runnersPath + name));
    json.caption = name.replace(/\.run$/, "");
    json.$builtin = true;
    runners[json.caption] = json;
});

module.exports = runners;
