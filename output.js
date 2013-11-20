define(function(require, exports, module) {
    main.consumes = [
        "Editor", "editors", "util", "commands", "menus", "terminal",
        "settings", "ui", "proc", "tabManager", "run", "console", "run.gui",
        "layout", "debugger", "settings", "dialog.question"
    ];
    main.provides = ["output"];
    return main;
    
    function main(options, imports, register) {
        var editors  = imports.editors;
        var ui       = imports.ui;
        var commands = imports.commands;
        var console  = imports.console;
        var menus    = imports.menus;
        var layout   = imports.layout;
        var tabs     = imports.tabManager;
        var run      = imports.run;
        var runGui   = imports["run.gui"];
        var question = imports["dialog.question"];
        var Terminal = imports.terminal.Terminal;
        var debug    = imports.debugger;
        var settings = imports.settings;
        
        var markup   = require("text!./output.xml");
        
        var extensions = [];
        
        // Set up the generic handle
        var handle = editors.register("output", "Output", 
                                       Output, extensions);
        
        handle.on("load", function(){
            menus.addItemByPath("View/Output",
              new apf.item({ command: "showoutput" }), 150, handle);
            
            commands.addCommand({
                name    : "showoutput",
                group   : "Panels",
                exec    : function (editor) {
                    // Search for the output pane
                    if (search()) return;
                    
                    // If not found show the console
                    console.show();
                    
                    // Search again
                    if (search()) return;
                    
                    // Else open the output panel in the console
                    tabs.open({
                        editorType : "output", 
                        active     : true,
                        pane        : console.getPanes()[0],
                        document   : {
                            title  : "Output",
                            output : {
                                id : "output"
                            }
                        }
                    }, function(){});
                }
            }, handle);
        });
        
        //Search through pages
        function search(id){
            if (!id) id = "output";
            var pages = tabs.getTabs(), session;
            for (var i = 0; i < pages.length; i++) {
                if (pages[i].editorType == "output"
                  && (session = pages[i].document.getSession())
                  && session.id == id) {
                    tabs.focusTab(pages[i]);
                    return true;
                }
            }
        }
        
        handle.search = search;
        
        /***** Initialization *****/
        
        function Output(){
            var plugin = new Terminal(true);
            
            var btnRun, currentSession, btnRunner, btnDebug;
            var tbName, tbCommand, btnEnv;
            
            /***** Methods *****/
            
            function runNow(session){
                if (!session)
                    session = currentSession;
                var runner = session.runner;
                
                var path = tbCommand.value || session.config.command;
                var args = path.split(" ");
                path = args.shift();
                
                if (session.process && session.process.running)
                    stop(done);
                else
                    done();
                
                function done(){
                    if (!runner)
                        runner = "auto";
                    
                    var bDebug = btnDebug.value;
                    // settings.getBool("user/runconfig/@debug");
                    
                    session.process = run.run(runner, {
                        path  : path,
                        cwd   : "",
                        name  : "",
                        args  : args,
                        debug : bDebug
                    }, function(err, pid){
                        if (err) {
                            transformButton(session);
                            session.process = null;
                            return layout.showError(err);
                        }
                        
                        var state = session.process.getState();
                        state.debug = bDebug;
                        settings.setJson("state/run/process", state); // @todo add identifier
                        
                        if (bDebug) {
                            debug.debug(session.process, function(err){
                                if (err)
                                    return; // Either the debugger is not found or paused
                            });
                        }
                    });
                    
                    decorateProcess(session);
                    transformButton(session);
                }
                
                runGui.lastRun = [runner, path];
            }
            
            function decorateProcess(session){
                session.process.on("away", function(){
                    if (session == currentSession)
                        btnRun.disable();
                });
                session.process.on("back", function(){
                    if (session == currentSession)
                        btnRun.enable();
                });
                session.process.on("stopping", function(){
                    if (session == currentSession)
                        btnRun.disable();
                }, plugin);
                session.process.on("stopped", function(){
                    if (session == currentSession) {
                        btnRun.enable();
                        transformButton(session);
                    }
                    
                    // settings.set("state/run/process", ""); // @todo
                }, plugin);
            }
            
            function transformButton(session){
                if (session.process && session.process.running) {
                    btnRun.setAttribute("icon", "stop.png");
                    btnRun.setAttribute("caption", "Stop");
                    btnRun.setAttribute("tooltip", "");
                    btnRun.setAttribute("class", "running");
                    btnRun.enable();
                }
                else {
                    var path = (tbCommand.value || "").split(" ", 1)[0];
                    
                    btnRun.setAttribute("icon", "run.png");
                    btnRun.setAttribute("caption", "Run");
                    btnRun.setAttribute("class", "stopped");
                    
                    return path;
                }
            }
            
            function stop(callback) {
                var session = currentSession
                var process = session.process;
                if (process)
                    process.stop(function(err){
                        if (err) {
                            layout.showError(err.message || err);
                        }
                        else {
                            debug.stop();
                        }
                        
                        if (session == currentSession)
                            transformButton(session);
                            
                        callback(err);
                    });
            }
            
            function detectRunner(session){
                var path = session.path;
                if (!path) return;
                
                run.detectRunner({ path: path }, function(err, runner){
                    session.setRunner(err ? null : runner);
                });
            }
            
            /***** Lifecycle *****/
            
            plugin.on("draw", function(e){
                // Create UI elements
                ui.insertMarkup(e.tab, markup, plugin);
                
                // Set output class name
                e.htmlNode.className += " output";
                
                // Decorate UI
                btnRun    = plugin.getElement("btnRun");
                btnDebug  = plugin.getElement("btnDebug");
                btnRunner = plugin.getElement("btnRunner");
                tbCommand = plugin.getElement("tbCommand");
                tbName    = plugin.getElement("tbName");
                btnEnv    = plugin.getElement("btnEnv");
                
                btnRun.on("click", function(){
                    var session = currentSession;
                    if (session.process && session.process.running){
                        stop(function(){});
                    }
                    else {
                        runNow();
                    }
                });
                
                btnDebug.on("prop.value", function(e){
                    currentSession.config.debug = e.value;
                });
                tbCommand.on("afterchange", function(e){
                    currentSession.config.command = e.value;
                });
                tbName.on("afterchange", function(e){
                    if (!e.value && currentSession.config.name) {
                        question("Remove this configuration?",
                            "You have cleared the name of this configuration.",
                            "Would you like to remove this configuration from your project settings?",
                            function(){ // Yes
                                var json = settings.getJson("project/run/configs");
                                delete json[currentSession.config.name];
                                settings.setJson("project/run/configs", json);
                            },
                            function(){ // No
                                // Revert change
                                tbName.setAttribute("value", currentSession.config.name);
                            });
                    }
                    else {
                        var json = settings.getJson("project/run/configs");
                        var cfg  = json[currentSession.config.name] 
                            || currentSession.config;
                        
                        cfg.name = e.value;
                        json[currentSession.config.name] = cfg;
                        
                        settings.setJson("project/run/configs", json);
                    }
                });
                
                btnRunner.setAttribute("submenu", runGui.getElement("mnuRunAs"));
                btnRunner.onitemclick = function(value){
                    // Stop the current process
                    // @todo
                    
                    // Start this run config with the new runner
                    run.getRunner(value, function(err, result){
                        if (err)
                            return layout.showError(err);
                        
                        currentSession.setRunner(result);
                    });
                    
                    // Set Button Caption
                    btnRunner.setAttribute("caption", "Runner: " + value)
                }
            });
            
            plugin.on("documentLoad", function(e){
                var doc     = e.doc;
                var tab    = e.doc.tab;
                var session = doc.getSession();
                
                // @todo set session.path
                // @todo enable debugging by default if runner supports it
                // @todo warn in runNow if debugger is already working and ask if the other should be stopped
                // @todo warn on close of output, asking to save config
                
                if (!session.config)
                    session.config = {};
                
                session.setRunner = function(runner){
                    session.runner = runner;
                    session.config.runner = runner.caption;
                    
                    if (session == currentSession) {
                        btnRunner.setAttribute("caption", "Runner: " 
                            + (runner ? runner.caption : "Auto"));
                        
                        if (!runner || runner.debugger)
                            btnDebug.show();
                        else
                            btnDebug.hide();
                    }
                }
                
                session.filter = function(data){
                    // Ignore clear screen when detaching
                    if (/output:0:.*\[dead\] - /.test(data))
                        return;

                    if (
                        /\[exited\]\r/.test(data) ||
                        /Set option: remain-on-exit \-\> on/.test(data)
                    ) {
                        tab.className.add("loading");
                        return;
                    }
                    
                    // Change the last lines of TMUX saying the pane is dead
                    if (data.indexOf("Pane is dead") > -1) {
                        if (data.lastIndexOf("\x1b[1mPane is dead\x1b[H") === 0) {
                            data = "\n[Process stopped]";
                        } else if (data === "\r\x1b[1mPane is dead\x1b[m\x1b[K") {
                            data = "";
                        } else {
                            data = data
                              .replace(/Pane is dead([\s\S]*)13H/g, "[Process stopped]$117H")
                              .replace(/Pane is dead/g, "[Process stopped]");
                        }
                        tab.className.remove("loading");
                    }
                    
                    return data;
                };
                    
                session.show = function(v){ 
                    // session.terminal.element.style.visibility = "visible";
                };
                
                session.hide = function(v){ 
                    // session.terminal.element.style.visibility = "hidden";
                };
                
                if (e.state.hidden || e.state.run)
                    session.hide();
                
                if (e.state.run) {
                    runNow(session);
                    // run.run(e.state.run.runner, e.state.run.options, 
                    //     session.id, function(err, pid){
                    //         session.show();
                    //     });
                }
            });
            
            plugin.on("documentActivate", function(e){
                currentSession = e.doc.getSession();
                
                updateToolbar(currentSession);
            });
            
            plugin.on("documentUnload", function(e){
                
            });
            
            plugin.on("getState", function(e){
                var session = e.doc.getSession();
                if (!session.id)
                    return;
                
                var state = e.state;
                state.config = session.config;
            });
            
            function updateConfig(session){
                var configs = settings.getJson("project/run/configs");
                var cfg = configs[session.config.name];
                if (!cfg) return;
                
                session.config = cfg;
                updateRunner(session);
                updateToolbar(session);
            }
            
            function updateRunner(session){
                
            }
            
            function updateToolbar(session){
                transformButton(session);
                
                var cfg = session.config;
                
                btnDebug.setAttribute("value", cfg.debug);
                btnRunner.setAttribute("caption", "Runner: " 
                    + (cfg.runner ? cfg.runner.caption : "Auto"));
                tbCommand.setAttribute("value", cfg.command);
                tbName.setAttribute("value", cfg.name);
                // btnEnv.setAttribute("value", );
            }
            
            plugin.on("setState", function(e){
                var session = e.doc.getSession();
                var state   = e.state;
                
                if (state.config) {
                    session.config = state.config;
                    updateConfig(session);
                }
            });
            
            plugin.on("unload", function(){
                
            });
            
            return plugin;
        }
        
        register(null, {
            output: handle
        });
    }
});