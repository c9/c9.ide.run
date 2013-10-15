define(function(require, module, exports) {
    main.consumes = [
        "c9", "Plugin", "run", "settings", "menus",
        "tabbehavior", "ace", "commands", "layout", "tabManager", "preferences", 
        "ui", "fs", "layout", "output", "debugger", "tree"
    ];
    main.provides = ["run.gui"];
    return main;

    function main(options, imports, register) {
        var Plugin      = imports.Plugin;
        var settings    = imports.settings;
        var menus       = imports.menus;
        var commands    = imports.commands;
        var run         = imports.run;
        var c9          = imports.c9;
        var ui          = imports.ui;
        var fs          = imports.fs;
        var layout      = imports.layout;
        var tree        = imports.tree;
        var tabs        = imports.tabManager;
        var output      = imports.output;
        var tabbehavior = imports.tabbehavior;
        var debug       = imports.debugger;
        var prefs       = imports.preferences;
        var ace         = imports.ace;
        
        var cssString = require("text!./style.css");
        var basename  = require("path").basename;

        /***** Initialization *****/
        
        var plugin  = new Plugin("Ajax.org", main.consumes);
        var emit    = plugin.getEmitter();
        
        var btnRun, lastRun, process;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            // Commands
            commands.addCommand({
                name    : "run",
                group   : "Run & Debug",
                "hint"  : "run or debug an application",
                bindKey : { mac: "Option-F5", win: "Alt-F5" },
                exec    : function(){ runNow() }
            }, plugin);
    
            commands.addCommand({
                name    : "stop",
                group   : "Run & Debug",
                "hint"  : "stop a running node program on the server",
                bindKey : { mac: "Shift-F5", win: "Shift-F5" },
                exec    : function(){ stop(function(){}) }
            }, plugin);
    
            commands.addCommand({
                name    : "runthisfile",
                group   : "Run & Debug",
                "hint"  : "run or debug this file (stops the app if running)",
                exec    : function(){ runThisFile() }
            }, plugin);
    
            commands.addCommand({
                name    : "runthistab",
                group   : "Run & Debug",
                "hint"  : "run or debug current file (stops the app if running)",
                exec    : function(){ runThisTab() },
                isAvailable : function(){
                    return tabs.focussedTab && tabs.focussedTab.path;
                }
            }, plugin);
    
            commands.addCommand({
                name    : "runlast",
                group   : "Run & Debug",
                "hint"  : "run or debug the last run file",
                bindKey: { mac: "F5", win: "F5" },
                exec    : function(){ runLastFile() },
                isAvailable : function(){
                    return lastRun ? true : false;
                }
            }, plugin);
            
            // Tree context menu
            // Needs to be hidden in readonly mode
            var itemCtxTreeRunFile = new apf.item({
                id      : "itemCtxTreeRunFile",
                match   : "[file]",
                visible : "{!c9.readonly}",
                command : "runthisfile",
                caption : "Run"
            });
            tree.getElement("mnuCtxTree", function(mnuCtxTree) {
                menus.addItemToMenu(mnuCtxTree, new apf.divider({
                    visible: "{!c9.readonly}"
                }), 800, plugin);
                menus.addItemToMenu(mnuCtxTree, itemCtxTreeRunFile, 810, plugin);
            });
            
            // Check after state.change
            c9.on("stateChange", function(e){
                // @todo consider moving this to the run plugin
                if (itemCtxTreeRunFile)
                    itemCtxTreeRunFile.setAttribute("disabled", !(e.state & c9.PROCESS));
            }, plugin);
            
            // Menus
            var c = 1000;
            menus.setRootMenu("Run", 600, plugin);
            var itmRun = menus.addItemByPath("Run/Run", new ui.item({
                isAvailable : function(){
                    var tab = tabs.focussedTab;
                    var path = tab && tab.path;
                    
                    if (process && process.running) {
                        itmRun.setAttribute("caption", "Stop"); 
                        itmRun.setAttribute("command", "stop"); 
                        return true;
                    }
                    else {
                        var runner = path && getRunner(path);
                        if (runner) {
                            itmRun.setAttribute("command", "run"); 
                            itmRun.setAttribute("caption", "Run " 
                                + basename(path) + " with "
                                + runner.caption);
                            return true;
                        }
                        else {
                            itmRun.setAttribute("command", "run"); 
                            itmRun.setAttribute("caption", "Run");
                            return false;
                        }
                    }
                }
            }), c += 100, plugin);
            var itmRunLast = menus.addItemByPath("Run/Run Last", new ui.item({
                command     : "runlast",
                isAvailable : function(){
                    if (process && process.running || !lastRun) {
                        itmRunLast.setAttribute("caption", "Run Last");
                        return false;
                    }
                    else {
                        var runner = lastRun[0] == "auto"
                            ? getRunner(lastRun[1])
                            : lastRun[0];
                        
                        itmRunLast.setAttribute("caption", "Run Last ("
                            + basename(lastRun[1]) + ", " 
                            + (runner.caption || "auto") + ")");
                        return true;
                    }
                }
            }), c += 100, plugin);
            menus.addItemByPath("Run/Show Output Window", new ui.item({
                command: "showoutput"
            }), c += 100, plugin);
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            menus.addItemByPath("Run/Run in Debug Mode", new ui.item({
                type    : "check",
                checked : "[{settings.model}::user/runconfig/@debug]"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Enable Source Maps", new ui.item({
                type    : "check",
                checked : "[{settings.model}::project/debug/@sourcemaps]"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Show Debugger at Break", new ui.item({
                type    : "check",
                checked : "[{settings.model}::user/debug/@autoshow]"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Show Output at Run", new ui.item({
                type    : "check",
                checked : "[{settings.model}::user/runconfig/@showconsole]"
            }), c += 100, plugin);
            
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            var mnuRunAs = new ui.menu({
                "onprop.visible": function(e){
                    if (e.value) {
                        run.listRunners(function(err, names){
                            var nodes = mnuRunAs.childNodes;
                            for (var i = nodes.length - 3; i >= 0; i--) {
                                mnuRunAs.removeChild(nodes[i]);
                            }
                            
                            var c = 300;
                            names.forEach(function(name){
                                menus.addItemToMenu(mnuRunAs, new ui.item({
                                    caption  : name.uCaseFirst(),
                                    value    : name
                                }), c++, plugin);
                            });
                        });
                    }
                },
                "onitemclick": function(e){
                    if (e.value == "new-run-system") {
                        tabs.open({
                            path   : settings.get("project/run/@path") 
                              + "/New Runner",
                            active : true,
                            value  : '{\n'
                              + '    "caption" : "",\n'
                              + '    "cmd" : ["ls"],\n'
                              + '    "hint" : "",\n'
                              + '    "selector": "source.ext"\n'
                              + '}',
                            document : {
                                meta : {
                                    newfile: true
                                },
                                ace : {
                                    customType : "json"
                                }
                            }
                        }, function(){});
                        return;
                    }
                    
                    run.getRunner(e.value, function(err, runner){
                        if (err)
                            return layout.showError(err);
                        
                        runNow(runner);
                    });
                    
                    settings.set("project/build/@builder", e.value);
                }
            });
            
            menus.addItemByPath("Run/Run With/", mnuRunAs, 
                c += 100, plugin);
            menus.addItemByPath("Run/Run History/", new ui.item({
                isAvailable : function(){ return false; }
            }), c += 100, plugin);
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            menus.addItemByPath("Run/Run Configurations", new ui.item({
                isAvailable : function(){ return false; }
            }), c += 100, plugin);
            
            c = 0;
            menus.addItemByPath("Run/Run With/~", new ui.divider(), c += 1000, plugin);
            menus.addItemByPath("Run/Run With/New Runner", new ui.item({
                value : "new-run-system"
            }), c += 100, plugin);
            
            // Other Menus
            
            var itmRunFile1 = new apf.item({ command : "runthistab" });
            var itmRunFile2 = new apf.item({ command : "runthistab" });
            
            menus.addItemByPath("View/Tabs/Run This File", itmRunFile1, 400, plugin);
            menus.addItemByPath("View/Tabs/~", new apf.divider(), 300, plugin)
    
            tabbehavior.getElement("mnuContextTabs", function(mnuContextTabs){
                menus.addItemByPath("~", new apf.divider(), 800, mnuContextTabs, plugin);
                menus.addItemByPath("Run This File", itmRunFile2, 850, mnuContextTabs, plugin);
            });
            
            // Draw
            draw();
            
            // Hooks
            function updateRunFile(){
                itmRunFile1.setAttribute("disable", !tabs.focussedTab ||
                    !tabs.focussedTab.path || !process || !process.running);
                itmRunFile2.setAttribute("disable", !tabs.focussedTab ||
                    !tabs.focussedTab.path || !process || !process.running);
            }
            
            // run.on("starting", updateRunFile, plugin);
            // run.on("started", updateRunFile, plugin);
            run.on("stopped", updateRunFile, plugin);
            
            c9.on("stateChange", function(e){
                btnRun.setAttribute("disabled", !(e.state & c9.PROCESS));
            }, plugin);
            
            // Preferences
            prefs.add({
                "Run" : {
                    position : 600,
                    "Run & Debug" : {
                        position : 100,
                        "Save All Unsaved Tabs Before Running" : {
                           type : "checkbox",
                           path : "user/runconfig/@saveallbeforerun",
                           position : 100
                        }
                    }
                }
            }, plugin);
            
            // settings
            settings.on("read", function(e){
                settings.setDefaults("user/runconfig", [
                    ["saveallbeforerun", "false"],
                    ["debug", "true"],
                    ["showconsole", "true"],
                    ["showruncfglist", "false"]
                ]);
            }, plugin);
    
            tabs.on("focus", function(e){
                updateRunFile();
                
                if (process && process.running)
                    return;
                
                if (e.tab.path) {
                    btnRun.enable();
                    btnRun.setAttribute("tooltip", "Run " 
                        + basename(e.tab.path));
                }
                else {
                    btnRun.disable();
                    btnRun.setAttribute("tooltip", "")
                }
            }, plugin);
            
            tabs.on("tabDestroy", function(e){
                updateRunFile();
                
                if (e.last) {
                    btnRun.disable();
                    btnRun.setAttribute("tooltip", "");
                }
            }, plugin);
    
            ace.getElement("menu", function(menu){
                menus.addItemToMenu(menu, new ui.item({
                    caption  : "Run This File",
                    command  : "runthistab",
                }), 800, plugin);
                menus.addItemToMenu(menu, new ui.divider(), 900, plugin);
            });
        };
        
        var drawn = false;
        function draw(){
            if (drawn) return;
            drawn = true;
    
            // Import CSS
            ui.insertCss(cssString, plugin);
            
            // Menus
            btnRun = ui.insertByIndex(layout.findParent(plugin), 
              new ui.button({
                id       : "btnRun",
                skin     : "c9-toolbarbutton-glossy",
                command  : "run",
                caption  : "Run",
                disabled : true,
                icon     : "run.png",
                visible  : "true"
            }), 100, plugin);
            
            emit("draw");
        }
        
        /***** Methods *****/
    
        function getRunner(path){
            var ext = fs.getExtension(path);
            for (var name in run.runners) {
                if (run.runners[name].selector == "source." + ext)
                    return run.runners[name];
            }
            return false;
        }
        
        function runNow(runner, path){
            if (!path) {
                path = tabs.focussedTab && tabs.focussedTab.path;
                if (!path) return;
            }
            
            if (process && process.running)
                stop(done);
            else
                done();
            
            function done(){
                if (!runner)
                    runner = "auto";
                
                if (settings.getBool("user/runconfig/@showconsole")) {
                    commands.exec("showoutput");
                }
                
                var bDebug = settings.getBool("user/runconfig/@debug");
                
                process = run.run(runner, {
                    path  : path,
                    debug : bDebug
                }, function(err, pid){
                    if (err) {
                        transformButton();
                        process = null;
                        return layout.showError(err);
                    }
                    
                    if (bDebug) {
                        debug.debug(process, function(err){
                            if (err)
                                return; // Either the debugger is not found or paused
                        });
                    }
                });
                
                process.on("stopping", function(){
                    btnRun.disable();
                }, plugin);
                
                process.on("stopped", function(){
                    btnRun.enable();
                    
                    var path = transformButton();
                    
                    if (path)
                        btnRun.enable();
                    else
                        btnRun.disable();
                }, plugin);
                
                transformButton("stop");
            }
            
            lastRun = [runner, path];
        }
        
        function transformButton(to){
            if (to == "stop") {
                btnRun.setAttribute("command", "stop");
                btnRun.setAttribute("icon", "stop.png");
                btnRun.setAttribute("caption", "Stop");
                btnRun.setAttribute("tooltip", "");
                btnRun.setAttribute("class", "running");
                btnRun.enable();
            }
            else {
                var path = tabs.focussedTab && tabs.focussedTab.path;
                    
                btnRun.setAttribute("icon", 
                    btnRun.checked ? "bug.png" : "run.png");
                btnRun.setAttribute("caption", "Run");
                btnRun.setAttribute("tooltip", (path 
                    ? "Run " + basename(path)
                    : ""));
                btnRun.setAttribute("class", "stopped");
                btnRun.setAttribute("command", "run");
                
                return path;
            }
        }
        
        function stop(callback) {
            if (process)
                process.stop(function(err){
                    if (err) {
                        layout.showError(err.message || err);
                        transformButton();
                    }
                    
                    debug.stop();
                    
                    callback(err);
                });
        }
        
        function runLastFile(){
            if (lastRun)
                runNow.apply(this, lastRun);
        }
    
        function runThisFile() {
            var file = tree.selected;
            var node = this.addConfig(true, file);
    
            this.runConfig(node);
        }
    
        function runThisTab() {
            var file = ide.getActiveTabModel();
            var node = this.addConfig(true, file);
    
            this.runConfig(node);
        }
    
        function onHelpClick() {
            var tab = "running_and_debugging_code";
            if (ide.infraEnv)
                require("ext/docum" + "entation/documentation").show(tab);
            else
                window.open("https://docs.c9.io/" + tab + ".html");
        }
    
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * UI for the {@link run} plugin. This plugin is responsible for the Run
         * menu in the main menu bar, as well as the settings and the 
         * preferences UI for the run plugin.
         * @singleton
         */
        /**
         * @command run Runs the currently focussed tab.
         */
        /**
         * @command stop Stops the running process.
         */
        /**
         * @command runlast Stops the last run file
         */
        plugin.freezePublicAPI({
            
        });
        
        register(null, {
            "run.gui": plugin
        });
    }
});
