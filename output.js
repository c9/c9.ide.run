 /**
 * Output viewer for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "editor", "editors", "util", "commands", "menus", "terminal",
        "settings", "ui", "proc", "c9", "tabs", "run", "console"
    ];
    main.provides = ["output"];
    return main;
    
    function main(options, imports, register) {
        var c9       = imports.c9;
        var editors  = imports.editors;
        var ui       = imports.ui;
        var commands = imports.commands;
        var console  = imports.console;
        var menus    = imports.menus;
        var tabs     = imports.tabs;
        var run      = imports.run;
        var Terminal = imports.terminal.Terminal;
        
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
                    // Search for the output tab
                    if (search()) return;
                    
                    // If not found show the console
                    console.show();
                    
                    // Search again
                    if (search()) return;
                    
                    // Else open the output panel in the console
                    tabs.open({
                        editorType : "output", 
                        active     : true,
                        tab        : console.getTabs()[0],
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
            var pages = tabs.getPages(), session;
            for (var i = 0; i < pages.length; i++) {
                if (pages[i].editorType == "output"
                  && (session = pages[i].document.getSession())
                  && session.id == id) {
                    tabs.focusPage(pages[i]);
                    return true;
                }
            }
        }
        
        handle.search = search;
        
        /***** Initialization *****/
        
        function Output(){
            var plugin = new Terminal(true);
            
            /***** Lifecycle *****/
            
            plugin.on("draw", function(e){
                // Create UI elements
                ui.insertMarkup(e.page, markup, plugin);
            });
            
            plugin.on("document.load", function(e){
                var doc     = e.doc;
                var page    = e.doc.page;
                var session = doc.getSession();
                
                session.filter = function(data){
                    // Ignore clear screen when detaching
                    if (/output:0:.*\[dead\] - /.test(data))
                        return;

                    if (
                        /\[exited\]\r/.test(data) ||
                        /Set option: remain-on-exit \-\> on/.test(data)
                    ) {
                        page.className.add("loading");
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
                        page.className.remove("loading");
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
                    run.run(e.state.run.runner, e.state.run.options, 
                        session.id, function(err, pid){
                            session.show();
                        });
                }
            });
            
            plugin.on("document.activate", function(e){
                
            });
            
            plugin.on("document.unload", function(e){
                
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