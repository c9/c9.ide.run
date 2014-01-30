# set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMUX=$1
NAME=$2
CMD=$3
DETACH=$4
BASE="$DIR/../"

WATCHFILE="$BASE.run_$NAME.watch"

if [ "$TMUX" = "pid" ]; then
    PID=`ps ax | grep "$WATCHFILE" | grep rm || echo -1`
    echo "PID: $PID"
    exit 0
fi

if [ ! -x "$TMUX" ]; then
    echo "Could not find executable tmux at $TMUX" >&2
    exit 100
fi

# This is needed for 32 bit tmux
export LD_LIBRARY_PATH="$BASE/local/lib:$LD_LIBRARY_PATH"

# Kill any existing session
"$TMUX" kill-session -t $NAME
    
# Write the watch file
echo "-1" > $WATCHFILE

# Tell the client to start the monitor
echo "MONITOR:1"

# Start a new session
"$TMUX" new -s $NAME "$CMD; ([ -e '$WATCHFILE' ] && rm '$WATCHFILE')" \
    \; set-option -g status off \
    \; set-option destroy-unattached off \
    \; set-option mouse-select-pane on \
    \; set-option set-titles on \
    \; set-option remain-on-exit on \
    \; set-window-option -g aggressive-resize on \
    \; set-option -g prefix C-b \
    \; $DETACH
    
# Return the pid
PID=`ps ax | grep "$WATCHFILE" | grep rm || echo -1`
echo "PID: $PID"
