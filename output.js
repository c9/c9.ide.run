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
            
            /***** Lifecycle *****/
            
            plugin.on("draw", function(e){
                // Create UI elements
                ui.insertMarkup(e.tab, markup, plugin);
            });
            
            plugin.on("documentLoad", function(e){
                var doc     = e.doc;
                var tab    = e.doc.tab;
                var session = doc.getSession();
                
                session.filter = function(data){
                    // Ignore clear screen when detaching
                    if (data.match(/output:0:.*\[dead\] - /))
                        return;

                    if (
                        data.match(/\[exited\]\r/) ||
                        data.match(/Set option: remain-on-exit \-\> on/)
                    ) {
                        tab.className.add("loading");
                        return;
                    }
                    
                    // Change the last lines of TMUX saying the pane is dead
                    if (data.indexOf("Pane is dead") > -1) {
                        data = data
                          .replace(/Pane is dead([\s\S]*)13H/g, "[Process stopped]$117H")
                          .replace(/Pane is dead/g, "[Process stopped]");
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
                    run.run(e.state.run.runner, e.state.run.options, 
                        session.id, function(err, pid){
                            session.show();
                        });
                }
            });
            
            plugin.on("documentActivate", function(e){
                
            });
            
            plugin.on("documentUnload", function(e){
                
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