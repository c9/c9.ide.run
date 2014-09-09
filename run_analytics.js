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
        
        run.on("create", function(e) {
            // Gets called whenever one creates a new process
            // analytics.track();
        });
        
        register(null, {
            "run_analytics": {}
        });
    }
});
