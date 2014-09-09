define(function(require, exports, module) {
    main.consumes = [
        "run"
    ];
    main.provides = ["run_analytics"];
    module.exports = main;
    
    return main;

    function main(options, imports, register) {
        var run = imports.run;
        run.on("create", function(e) {
            // Start
            // track here
        });
        
        register(null, {
            "run_analytics": {}
        });
    }
});
