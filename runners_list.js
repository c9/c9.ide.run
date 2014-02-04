var fs = require("fs");

function readRunners(path) {
    var results = {};
    var runnersPath = __dirname + "/" + path + "/";
    fs.readdirSync(runnersPath).forEach(function (name) {
        var json = JSON.parse(fs.readFileSync(runnersPath + name));
        json.caption = name.replace(/\.run$/, "");
        json.$builtin = true;
        results[json.caption] = json;
    });
    return results;
}

module.exports.runners = readRunners("runners");

module.exports.hostedRunners = readRunners("runners-hosted");
