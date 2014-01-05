# set -e

TMUX=$1
NAME=$2
CMD=$3
DETACH=$4
TESTING=$5

if [ $TESTING ]; then
    BASE=$TESTING
else
    BASE="$HOME/.c9/"
fi

WATCHFILE="$BASE.run_$NAME.watch"

if [ $TMUX == "pid" ]; then
    ps ax | grep $WATCHFILE | grep rm || echo -1
    exit 0
fi

# Try to figure out the os and arch for binary fetching
# uname="$(uname -a)"
# os=""
# case "$uname" in
#     Linux\ *) os=linux ;;
#     Darwin\ *) os=darwin ;;
#     SunOS\ *) os=sunos ;;
#     FreeBSD\ *) os=freebsd ;;
# esac

# This is needed for 32 bit tmux
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:~/.c9/local/lib

# Kill any existing session
$TMUX kill-session -t $NAME
    
# Write the watch file
echo "-1" > $WATCHFILE

# Start a new session
$TMUX new -s $NAME "$CMD; ([ -e $WATCHFILE ] && rm $WATCHFILE)" \
    \; set-option -g status off \
    \; set-option destroy-unattached off \
    \; set-option mouse-select-pane on \
    \; set-option set-titles on \
    \; set-option remain-on-exit on \
    \; set-window-option -g aggressive-resize on \
    \; set-option -g prefix C-b \
    \; $DETACH

# Find the PID
# if [ $os = "darwin" ]; then
#     PID=`ps -axf | grep $WATCHFILE`
# else
#     PID=`ps axf | grep $WATCHFILE`
# fi
# PID=`pgrep -f $WATCHFILE`


# Return the pid
PID=`ps ax | grep $WATCHFILE | grep rm || echo -1`
echo "PID: $PID"