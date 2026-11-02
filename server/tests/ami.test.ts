import { describe, expect, it } from "vitest";
import { consumeAmiBuffer } from "../src/adapters/ami/parser.js";
import { interfaceIdentity, mapAmiMessage, memberStatus } from "../src/adapters/ami/map.js";

const JOIN = [
  "Event: QueueCallerJoin",
  "Privilege: agent,all",
  "Queue: support",
  "Uniqueid: 1730554215.23",
  "CallerIDNum: 08031234567",
  "CallerIDName: Adaeze Umeh",
  "Position: 1",
  "Count: 1",
].join("\r\n");

describe("AMI parser", () => {
  it("reassembles a frame that arrives in two chunks and ignores the banner", () => {
    const banner = "Asterisk Call Manager/18.26.0\r\n\r\n";
    const first = consumeAmiBuffer(banner + JOIN.slice(0, 40));
    expect(first.messages).toHaveLength(0);
    const second = consumeAmiBuffer(first.rest + JOIN.slice(40) + "\r\n\r\n");
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]?.fields.Event).toBe("QueueCallerJoin");
    expect(second.rest).toBe("");
  });

  it("parses a login response", () => {
    const { messages } = consumeAmiBuffer(
      "Response: Success\r\nMessage: Authentication accepted\r\n\r\n",
    );
    expect(messages[0]).toMatchObject({ kind: "response", fields: { Response: "Success" } });
  });
});

describe("AMI event mapping", () => {
  const at = "2026-11-02T15:00:00.000Z";

  function map(frame: string) {
    const { messages } = consumeAmiBuffer(frame.endsWith("\r\n\r\n") ? frame : `${frame}\r\n\r\n`);
    const message = messages[0];
    if (!message) throw new Error("no frame");
    return mapAmiMessage(message, at);
  }

  it("normalizes queue member interfaces", () => {
    expect(interfaceIdentity("PJSIP/1003-0000001a")).toEqual({ id: "PJSIP/1003", extension: "1003" });
    expect(interfaceIdentity("SIP/1001")).toEqual({ id: "SIP/1001", extension: "1001" });
    expect(interfaceIdentity("Local/1005@from-queue/n")).toEqual({
      id: "Local/1005@from-queue",
      extension: "1005",
    });
  });

  it("maps device status the way a wallboard should", () => {
    expect(memberStatus(1, false)).toBe("available");
    expect(memberStatus(1, true)).toBe("paused");
    expect(memberStatus(2, true)).toBe("on-call");
    expect(memberStatus(6, false)).toBe("available");
    expect(memberStatus(5, false)).toBe("offline");
    expect(memberStatus(8, false)).toBe("on-call");
  });

  it("maps the queue events the reducer understands", () => {
    expect(map(JOIN)).toMatchObject({
      type: "caller.join",
      queueId: "support",
      callId: "1730554215.23",
      callerNumber: "08031234567",
      callerName: "Adaeze Umeh",
    });

    expect(
      map(
        [
          "Event: QueueEntry",
          "Queue: support",
          "Uniqueid: 1730554300.40",
          "CallerIDNum: 07039887766",
          "CallerIDName: unknown",
          "Wait: 42",
        ].join("\r\n"),
      ),
    ).toMatchObject({ type: "caller.join", alreadyWaitingSeconds: 42, callerName: "unknown" });

    expect(
      map(
        [
          "Event: AgentConnect",
          "Queue: support",
          "Uniqueid: 1730554215.23",
          "Interface: Local/1003@from-queue/n",
          "MemberName: Fatima Bello",
          "HoldTime: 18",
          "CallerIDNum: 08031234567",
        ].join("\r\n"),
      ),
    ).toMatchObject({
      type: "call.answered",
      agentId: "Local/1003@from-queue",
      agentExtension: "1003",
      agentName: "Fatima Bello",
      waitSeconds: 18,
    });

    expect(
      map(
        [
          "Event: AgentComplete",
          "Queue: support",
          "Uniqueid: 1730554215.23",
          "Interface: PJSIP/1003",
          "TalkTime: 142",
          "HoldTime: 18",
          "Reason: caller",
        ].join("\r\n"),
      ),
    ).toMatchObject({ type: "call.hangup", callId: "1730554215.23", talkSeconds: 142 });

    expect(
      map(
        [
          "Event: QueueCallerAbandon",
          "Queue: support",
          "Uniqueid: 1730554300.40",
          "HoldTime: 42",
        ].join("\r\n"),
      ),
    ).toMatchObject({ type: "caller.abandon", waitSeconds: 42 });

    expect(
      map(
        [
          "Event: QueueMemberPause",
          "Queue: support",
          "Interface: PJSIP/1005",
          "MemberName: Ngozi Eze",
          "Paused: 1",
          "PausedReason: Lunch",
        ].join("\r\n"),
      ),
    ).toMatchObject({ type: "agent.pause", agentId: "PJSIP/1005", paused: true, reason: "Lunch" });

    const params = map(
      [
        "Event: QueueParams",
        "Queue: support",
        "Strategy: leastrecent",
        "Calls: 2",
        "Holdtime: 15",
        "TalkTime: 180",
        "Completed: 40",
        "Abandoned: 3",
        "ServiceLevel: 20",
        "ServicelevelPerf: 85.5",
      ].join("\r\n"),
    );
    expect(params).toMatchObject({
      type: "queue.upsert",
      queue: {
        id: "support",
        strategy: "leastrecent",
        slaThresholdSeconds: 20,
        pbx: { completed: 40, abandoned: 3, serviceLevelPerf: 85.5, holdTimeSeconds: 15, talkTimeSeconds: 180 },
      },
    });
  });

  it("ignores events that are not part of the wallboard", () => {
    expect(map("Event: PeerStatus\r\nPeer: PJSIP/1001\r\nPeerStatus: Reachable")).toBeNull();
  });
});
