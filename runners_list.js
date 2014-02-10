var fs = require("fs");

function readRunners(path) {
    var results = {};
    var runnersPath = __dirname + "/" + path + "/";
    fs.readdirSync(runnersPath).forEach(function (name) {
        var json;
        try {
            json = JSON.parse(fs.readFileSync(runnersPath + name, "utf8").replace(/\/\/.*$/mg, ""));
        } catch (e) {
            console.error("Syntax error in runner", runnersPath + name, e);
            throw e;
        }
        json.caption = name.replace(/\.run$/, "");
        json.$builtin = true;
        results[json.caption] = json;
    });
    return results;
}

module.exports = {
    local: readRunners("runners"),
    openshift: readRunners("runners-openshift"),
    docker: readRunners("runners-docker")
};

module.exports.ssh = module.exports.local;