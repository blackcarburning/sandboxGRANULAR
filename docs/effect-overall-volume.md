# Effect overall volume

Each of the eleven Cooking Pot insert-effect cards has a 0–100% output fader
in a green box immediately below its Dry/Wet control. It defaults to 100%.

`modes.effectOutput.volumes` stores only nonunity gains. The gain is applied to
the complete dry/wet-blended result at the last powered stage of each source's
chain, through the existing context-owned terminal return gain. Earlier faders
do not attenuate the next effect's excitation. A chain ending on a different
effect uses that effect's fader; an Off stage is absent and the preceding powered
stage becomes terminal. Unrouted sources retain their original main path.

The existing master-volume proxies and Through Main controls keep their meaning.
The new gain multiplies, rather than replaces, terminal main-volume/mute/Solo
gates. Existing recipe return/output controls and LFOs remain independent.
Master Baker remains the final mastering stage with its existing master controls.
No gain nodes, DSP latency, excitation changes or new polling timers are added.

Only nonunity gains owning a non-external terminal source require effect-output
capability 6. JS and Python calculate the same terminal ownership. Source hashes
and revisions stay immutable. Unity, disabled/nonterminal/external-only settings
are omitted from render content so unchanged audio keeps its cache identity.
Generic slider inventories exclude the fader; effectOutput is the single saved
owner. All controls participate in history and existing JSON/ZIP/local saves.
