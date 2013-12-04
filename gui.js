define(function(require, module, exports) {
    main.consumes = [
        "c9", "Plugin", "run", "settings", "menus", "tabbehavior", "ace", 
        "commands", "layout", "tabManager", "preferences", "ui", "fs", 
        "layout", "debugger", "tree"
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
        var tabbehavior = imports.tabbehavior;
        var debug       = imports.debugger;
        var prefs       = imports.preferences;
        var ace         = imports.ace;
        
        var cssString = require("text!./style.css");
        var basename  = require("path").basename;
        
        /***** Initialization *****/
        
        var plugin  = new Plugin("Ajax.org", main.consumes);
        var emit    = plugin.getEmitter();
        
        var counter = 0;
        var btnRun, lastRun, process, mnuRunCfg;
        
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
            var itemCtxTreeRunFile = new ui.item({
                match   : "file",
                enabled : !c9.readonly,
                caption : "Run",
                isAvailable : function(){
                    return tree.selectedNode && !tree.selectedNode.isFolder;
                },
                onclick : function(){
                    runNow("auto", tree.selected);
                }
            });
            tree.getElement("mnuCtxTree", function(mnuCtxTree) {
                menus.addItemToMenu(mnuCtxTree, itemCtxTreeRunFile, 150, plugin);
            });
            
            // Check after state.change
            c9.on("stateChange", function(e){
                // @todo consider moving this to the run plugin
                if (itemCtxTreeRunFile && !c9.readonly)
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
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            // menus.addItemByPath("Run/Enable Source Maps", new ui.item({
            //     type    : "check",
            //     checked : "[{settings.model}::project/debug/@sourcemaps]"
            // }), c += 100, plugin);
            menus.addItemByPath("Run/Show Debugger at Break", new ui.item({
                type    : "check",
                checked : "[{settings.model}::user/debug/@autoshow]"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Show Output at Run", new ui.item({
                type    : "check",
                checked : "[{settings.model}::user/runconfig/@showconsole]"
            }), c += 100, plugin);
            
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            var lastOpener, preventLoop;
            var mnuRunAs = new ui.menu({
                id: "mnuRunAs",
                "onprop.visible": function(e){
                    if (e.value && !preventLoop) {
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
                            
                            if (mnuRunAs.visible && mnuRunAs.opener 
                              && mnuRunAs.opener.localName == "button") {
                                preventLoop = true;
                                mnuRunAs.display(null, 
                                    null, true, mnuRunAs.opener);
                                preventLoop = false;
                            }
                        });
                        
                        lastOpener = this.opener;
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
                    
                    if (lastOpener && lastOpener.onitemclick)
                        return lastOpener.onitemclick(e.value);
                    
                    run.getRunner(e.value, function(err, runner){
                        if (err)
                            return layout.showError(err);
                        
                        runNow(runner);
                    });
                    
                    settings.set("project/run/@runner", e.value);
                }
            });
            mnuRunCfg = new ui.menu({
                id : "mnuRunCfg",
                "onprop.visible": function(e){
                    if (e.value) {
                        var nodes = mnuRunCfg.childNodes;
                        for (var i = nodes.length - 4; i >= 0; i--) {
                            mnuRunCfg.removeChild(nodes[i]);
                        }
                        
                        var configs = settings.getJson("project/run/configs") || {};
                        for (var name in configs) {
                            var c = 0;
                            menus.addItemToMenu(mnuRunCfg, new ui.item({
                                caption  : name,
                                value    : configs[name]
                            }), c++, plugin);
                        }
                    }
                },
                "onitemclick": function(e){
                    if (e.value == "new-run-config") {
                        commands.exec("showoutput", null, {
                            id : getOutputId()
                        });
                        return;
                    }
                    else if (e.value == "manage") {
                        commands.exec("openpreferences", null, {
                            pane: "project"
                        });
                        return;
                    }
                    
                    openRunConfig(e.value);
                }
            });
            plugin.addElement(mnuRunAs, mnuRunCfg);
            
            menus.addItemByPath("Run/Run With/", mnuRunAs, c += 100, plugin);
            menus.addItemByPath("Run/Run History/", new ui.item({
                isAvailable : function(){ return false; }
            }), c += 100, plugin);
            menus.addItemByPath("Run/Run Configurations/", mnuRunCfg, c += 100, plugin);

            c = 0;
            menus.addItemByPath("Run/Run Configurations/~", new ui.divider(), c += 1000, plugin);
            menus.addItemByPath("Run/Run Configurations/New Run Configuration", new ui.item({
                value : "new-run-config"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Run Configurations/Manage...", new ui.item({
                value : "manage"
            }), c += 100, plugin);
            
            c = 0;
            menus.addItemByPath("Run/Run With/~", new ui.divider(), c += 1000, plugin);
            menus.addItemByPath("Run/Run With/New Runner", new ui.item({
                value : "new-run-system"
            }), c += 100, plugin);
            
            // Other Menus
            
            var mnuContext = tabbehavior.contextMenu;
            // menus.addItemByPath("~", new ui.divider(), 800, mnuContext, plugin);
            menus.addItemByPath("Run This File", new ui.item({ 
                onclick : function(){
                    var tab = mnuContext.$tab;
                    if (tab && tab.path)
                        runNow("auto", tab.path);
                },
                isAvailable: function(){
                    var tab = mnuContext.$tab;
                    return tab && tab.path && (!process || !process.running);
                }
            }), 150, mnuContext, plugin);
            
            // Draw
            draw();
            
            // Preferences
            prefs.add({
                "Run" : {
                    position : 600,
                    "Run & Debug" : {
                        position : 100,
                        "Save All Unsaved Tabs Before Running" : {
                           type     : "checkbox",
                           path     : "user/runconfig/@saveallbeforerun",
                           position : 100
                        }
                    },
                    "Run Configurations" : {
                        position : 200,
                        "Run Configurations" : {
                            type     : "custom",
                            title    : "Run Configurations",
                            position : 120,
                            node     : new ui.hsplitbox({
                                height     : 200,
                                padding    : 5,
                                anchors    : "80 0 0 0",
                                edge       : "10 10 10 10",
                                childNodes : [
                                    
                                ]
                            })
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
                
                var state = settings.getJson("state/run/process");
                if (state) {
                    process = run.restoreProcess(state);
                    decorateProcess();
                    transformButton("stop");
                    
                    if (state.debug) {
                        process.on("back", function(){
                            debug.debug(process, true, function(err){
                                if (err)
                                    return; // Either the debugger is not found or paused
                            });
                        });
                    }
                }
            }, plugin);
    
            tabs.on("focus", function(e){
                if (process && process.running)
                    return;
                
                var path = findTabToRun();
                if (path) {
                    btnRun.enable();
                    btnRun.setAttribute("command", "run");
                    btnRun.setAttribute("caption", "Run");
                    btnRun.setAttribute("tooltip", "Run " 
                        + basename(path));
                }
                else if (lastRun) {
                    var runner = lastRun[0] == "auto"
                        ? getRunner(lastRun[1])
                        : lastRun[0];
                    
                    btnRun.enable();
                    btnRun.setAttribute("command", "runlast");
                    btnRun.setAttribute("caption", "Run Last");
                    btnRun.setAttribute("tooltip", "Run Last ("
                        + basename(lastRun[1]) + ", " 
                        + (runner.caption || "auto") + ")");
                }
                else {
                    btnRun.disable();
                    btnRun.setAttribute("caption", "Run");
                    btnRun.setAttribute("tooltip", "")
                }
            }, plugin);
            
            tabs.on("tabDestroy", function(e){
                if (e.last) {
                    btnRun.disable();
                    btnRun.setAttribute("tooltip", "");
                }
            }, plugin);
    
            ace.getElement("menu", function(menu){
                menus.addItemToMenu(menu, new ui.item({
                    caption  : "Run This File",
                    command  : "run",
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
            
            btnRun.on("contextmenu", function(e){
                mnuRunCfg.display(e.x, e.y);
                return false;
            });
            
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
        
        function getOutputId(){
            return "output" + Math.round(Math.random()*100000) + counter++;
        }
        
        function openRunConfig(cfg){
            var found = false;
            tabs.getTabs().some(function(tab){
                if (tab.editorType == "output" 
                  && tab.document.getSession().config.name == cfg.name) {
                    found = tab;
                    return true;
                }
            });
            
            if (found) {
                var session = found.document.getSession();
                if (!session.process || !session.process.running)
                    session.run();
                return tabs.focusTab(found);
            }
            
            commands.exec("showoutput", null, {
                id     : getOutputId(),
                run    : true,
                config : cfg
            });
        }
        
        function runNow(runner, path){
            if (!path) {
                path = findTabToRun();
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
                    // @todo use run config instead
                    
                    commands.exec("showoutput", null, {
                        id     : getOutputId(),
                        runner : runner,
                        run    : true,
                        config : {
                            runner  : runner.name || runner,
                            command : path
                        }
                    });
                    
                    return; // @todo unless global
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
                    
                    var state = process.getState();
                    state.debug = bDebug;
                    settings.setJson("state/run/process", state);
                    
                    if (bDebug) {
                        debug.debug(process, function(err){
                            if (err)
                                return; // Either the debugger is not found or paused
                        });
                    }
                });
                
                decorateProcess();
                transformButton("stop");
            }
            
            lastRun = [runner, path];
        }
        
        function decorateProcess(){
            process.on("away", function(){
                btnRun.disable();
            }, plugin);
            process.on("back", function(){
                btnRun.enable();
            }, plugin);
            process.on("stopping", function(){
                btnRun.disable();
            }, plugin);
            process.on("stopped", function(){
                btnRun.enable();
                
                var path = transformButton();
                if (path || lastRun)
                    btnRun.enable();
                else
                    btnRun.disable();
                
                settings.set("state/run/process", "");
            }, plugin);
        }
        
        function findTabToRun(){
            var path = tabs.focussedTab && tabs.focussedTab.path;
            if (path) return path;
            
            var foundActive;
            if (tabs.getPanes().every(function(pane){
                var tab = pane.activeTab;
                if (tab && tab.path) {
                    if (foundActive) return false;
                    foundActive = tab;
                }
                return true;
            }) && foundActive) {
                return foundActive.path;
            }
            
            return false;
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
                var path = findTabToRun();
                
                var runner = !path && lastRun && (lastRun[0] == "auto"
                    ? getRunner(lastRun[1])
                    : lastRun[0]);
                    
                btnRun.setAttribute("icon", "run.png");
                btnRun.setAttribute("caption", !path && lastRun ? "Run Last" : "Run");
                btnRun.setAttribute("tooltip", path 
                    ? "Run " + basename(path)
                    : (lastRun 
                        ? "Run Last ("
                            + basename(lastRun[1]) + ", " 
                            + (runner.caption || "auto") + ")"
                        : ""));
                btnRun.setAttribute("class", "stopped");
                btnRun.setAttribute("command", !path && lastRun ? "runlast" : "run");
                
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
            get lastRun(){ return lastRun },
            set lastRun(lr){ lastRun = lr }
        });
        
        register(null, {
            "run.gui": plugin
        });
    }
});