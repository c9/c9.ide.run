define(function(require, exports, module) {
    main.consumes = [
        "run", "c9.analytics", "c9.analytics.cookie"
    ];
    main.provides = ["run_analytics"];
    module.exports = main;
    
    return main;

    function main(options, imports, register) {
        var analytics = imports["c9.analytics"];
        var cookie = imports["c9.analytics.cookie"];
        var run = imports.run;
        var COOKIE_RUNNERS_NAME = "c9_runners_timestamp";
        
        // Always track in DWH
        var analyticsOptions = {
            integrations: {
                "All": false,
                "DWH": true
            }
        };
        
        run.on("create", function(e) {
            // Gets called whenever one creates a new process
            var runner = e.process.runner[0];
            var builtin = runner.$builtin;
            var runnerName = runner.caption;
            var cmdLength = runner.cmd.length;
            var properties = {
                builtin: builtin,
                runnerName: runnerName,
                numParamsInCommand: cmdLength
            };
            
            // Once a day, if the Runner isn't used yet, track in all providers
            try {
                var rCookie = JSON.parse(cookie.get(COOKIE_RUNNERS_NAME));
                
                if (!rCookie[runnerName] || 
                    !rCookie[runnerName].lastTimeLogged || 
                    rCookie[runnerName].lastTimeLogged === "" || 
                    new Date(+rCookie[runnerName].lastTimeLogged).getDate() != 
                    new Date().getDate()) {
                        sendToAllIntegrations(rCookie);
                }
            }
            catch (e) {
                sendToAllIntegrations(rCookie);
            }
            
            function sendToAllIntegrations(rCookie) {
                analyticsOptions.integrations["All"] = true;
                
                rCookie = rCookie ? rCookie : {};
                rCookie[runnerName] = { lastTimeLogged: Date.now() };
                cookie.set(COOKIE_RUNNERS_NAME, JSON.stringify(rCookie), 1);
            }
            
            analytics.track("Runner Started", properties, analyticsOptions);
        });

        // TODO: Send event when new Run Config is saved
        run.on("runconfigsaved", function(e) {
            // only when it's a name change
        });
        // TODO: Send event when CWD is set
        run.on("cwdset", function(e) {
            // only if different from previous value
        });
        // TODO: Send event when Environment variables are set
        run.on("envset", function(e) {
            // number of key-value pairs
        });
        
        register(null, {
            "run_analytics": {}
        });
    }
});
