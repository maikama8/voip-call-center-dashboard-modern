# Asterisk AMI and Vicidial

Callboard's live source is the Asterisk Manager Interface. The same reducer that the simulated floor uses consumes the events, so a queue name, an agent interface, and a uniqueid are the only things that have to line up.

## Manager user

Copy [`manager.conf`](manager.conf). Set `secret`, and set `permit` to the host that runs the dashboard. From the dashboard:

```bash
DATA_SOURCE=ami
AMI_HOST=192.0.2.10
AMI_PORT=5038
AMI_USERNAME=callboard
AMI_SECRET=CHANGE_ME
```

`127.0.0.1` inside Docker is the container, not the PBX. Use the PBX address, or the host gateway if Asterisk is on the same machine.

On connect the process sends `Login`, then `QueueStatus`, then `Ping` every 20 seconds. If the socket drops it waits `AMI_RECONNECT_MS` and tries again. A refused login is logged without the secret.

`QueueStatus` is refused when the user lacks the `agent` write class. The message from Asterisk names the class. Widen `write` to match that, and no further. Do not grant `originate` or `command`.

## What is mapped

| AMI | Wallboard |
| --- | --- |
| `QueueParams` | Queue name, strategy, `ServiceLevel` as the threshold (unless `QUEUE_SLA` overrides it), and the PBX counters |
| `QueueMember`, `QueueMemberStatus` | Agent, one row per interface, queues unioned |
| `QueueMemberPause` | Paused, or pause-after-call when the device is already in use |
| `QueueMemberRemoved` | Drops that queue. An agent left with no queue and no call is offline |
| `QueueEntry` | Caller already waiting. `Wait` is the age |
| `QueueCallerJoin` | Caller enters |
| `QueueCallerLeave` | Drops the waiting row only. It fires for both answer and abandon, so it does not record an outcome |
| `QueueCallerAbandon` | Abandoned outcome. `HoldTime` is the wait |
| `AgentConnect` | Answered. `HoldTime` is the wait, `Interface` is the agent |
| `AgentComplete` | Hangup. `TalkTime` is the talk |
| `Hangup` | Closes a call this process already knows. Other channels are ignored |

Interfaces are normalized before they become an agent id: `PJSIP/1001-00000a1b` and `Local/1001@from-queue/n` both collapse to the endpoint, not the per-call leg. `MemberName` is the display name.

Device status on a queue member: 1 not in use → available, 2/3/7/8 → on call, 6 ringing → available, 4/5/0 → offline. Paused wins unless the device is in use, in which case the pause is applied when wrap-up ends.

Asterisk does not emit a wrap-up event. `queues.conf` `wrapuptime` keeps the member paused, but Manager does not label that pause. `AMI_WRAPUP_SECONDS` is this process's own hold after `AgentComplete`. Leave it at `0` when the queue's wrapuptime is 0 so the agent returns to available immediately. Set it to the same number as `wrapuptime` when you want the board to show wrap-up.

## Numbers

Two clocks run side by side once AMI is connected.

**Observed**, labelled "Since connect" on the board. Computed from events this process has seen. A restart starts them over. The formulas are in the README.

**PBX counters**, from `QueueParams`, labelled "PBX" on the queue card. `ServicelevelPerf`, `Holdtime`, `TalkTime`, `Completed`, and `Abandoned` are Asterisk's, since the queue was loaded, and they follow `servicelevel` in `queues.conf`. They are not copied into the observed KPIs. Asterisk's service level and this board's service level are different ratios. Showing both is deliberate.

`QUEUE_SLA=support:80:20` forces the target and the threshold for that queue name. Without an override, the target is 80% and the threshold is `ServiceLevel` from the PBX, or 20 seconds if the PBX has not sent one.

## FreePBX

Add the manager user under **Settings → Asterisk Manager Users**, with the same read and write classes. Queues are the FreePBX queues (Applications → Queues). The queue name in `QUEUE_SLA` is the queue number or name Asterisk reports, which you can see on the card after the first `QueueParams`.

Static and dynamic members both arrive as `QueueMember`. A member logged out with `QueueMemberRemoved` leaves the queue. Pause reasons typed in FreePBX arrive as `PausedReason`.

## Vicidial

Vicidial talks to Asterisk over AMI too, but an agent on a campaign is not usually a member of `app_queue`. Outbound agents sit in a MeetMe or ConfBridge room. Those agents do not appear through the queue events this adapter listens for, and the board will not invent them.

Inbound closer groups that are real Asterisk queues do show up. Point `AMI_HOST` at the dialer, with a dedicated manager user as above. Do not reuse Vicidial's own AMI user.

Vicidial's own agent table is `vicidial_live_agents`. The status column maps onto the four states on this board:

| `vicidial_live_agents.status` | Wallboard |
| --- | --- |
| `READY` | available |
| `INCALL`, `QUEUE`, `CLOSER` | on call |
| `PAUSED` | paused (`vicidial_pause_codes`) |
| `DISPO` | wrap-up |

Reading that table is a separate adapter. It is not built. The simulated source uses the same four states so the board you run locally is the board that adapter would fill.

## A safe check

From the PBX, with the user above:

```bash
asterisk -rx "manager show connected"
```

After the dashboard logs in you should see `callboard`. `QueueStatus` in the same CLI (`queue show`) should agree with the waiting counts on the board. The observed service level will not agree with `ServicelevelPerf` until this process has watched a comparable set of calls, and even then the short-abandon rule may differ.
