// The door's two files, rebuilt at every start from the fixed template below and the seats only
// (PLAN-DESKTOP, "The door's configuration" and "A seat's line"). Nothing here is ever edited in place.

// The office's private networks: the door refuses every other caller (DW6).
export const PRIVATE_NETS = Object.freeze(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]);
const LISTEN_ALL = "0.0.0.0";
// The door's tests listen on 127.0.0.1 only and let only 127.0.0.0/8 in (rule 3). ENGINE_REMOTE_LOOPBACK=1
// narrows the door to this Mac alone; it never widens it.
const LOOPBACK = "127.0.0.1";
const LOOPBACK_NET = "127.0.0.0/8";

// The ports one seat's key may open: its own seat port, and for `desk` the preview's and the apps' ports.
export function seatPorts(seat, ports) {
  const own = [ports.seat(seat.n)];
  return seat.role === "desk" ? own.concat(ports.apps) : own;
}

// Throws when a seat would be given a port that is never forwarded (the home's, the board's, another seat's…).
export function checkPorts(seats, ports) {
  const seatPortsAll = [1, 2, 3, 4, 5].map((n) => ports.seat(n));
  for (const s of seats) {
    const others = seatPortsAll.filter((p) => p !== ports.seat(s.n));
    for (const p of seatPorts(s, ports)) {
      if (ports.never.includes(p) || others.includes(p) || (s.role === "desk" && ports.apps.includes(ports.seat(s.n)))) {
        throw new Error("its ports overlap the engine's own");
      }
    }
  }
}

// One line of authorized_keys. The options and the comment are the engine's; only the key comes from the PC.
export function seatLine(seat, key, ports) {
  const opens = seatPorts(seat, ports).map((p) => `permitopen="127.0.0.1:${p}"`).join(",");
  return `restrict,port-forwarding,${opens} ssh-ed25519 ${key} seat-${seat.n}`;
}

export function authorizedKeys(seats, keys, ports) {
  const lines = seats.filter((s) => s.state === "allowed" && keys[s.n]).map((s) => seatLine(s, keys[s.n], ports));
  return lines.join("\n") + (lines.length ? "\n" : "");
}

// The whole sshd_config. `owner` is this Mac's short user name; `loopback` is for the tests only.
export function sshdConfig({ paths, ports, owner, seats, loopback = false }) {
  const allowed = seats.filter((s) => s.state === "allowed");
  const opens = [];
  for (const s of allowed) for (const p of seatPorts(s, ports)) if (!opens.includes(p)) opens.push(p);
  const nets = loopback ? [LOOPBACK_NET] : PRIVATE_NETS;
  const lines = [
    `Port ${ports.door}`,
    "AddressFamily inet",
    `ListenAddress ${loopback ? LOOPBACK : LISTEN_ALL}`,
    `HostKey ${paths.hostKey}`,
    "HostKeyAlgorithms ssh-ed25519",
    "PubkeyAcceptedAlgorithms ssh-ed25519",
    `AuthorizedKeysFile ${paths.authorizedKeys}`,
    `PidFile ${paths.pid}`,
    "UsePAM no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "PubkeyAuthentication yes",
    "PermitRootLogin no",
    `AllowUsers ${nets.map((n) => `${owner}@${n}`).join(" ")}`,
    "AllowTcpForwarding local",
    `PermitOpen ${opens.length ? opens.map((p) => `127.0.0.1:${p}`).join(" ") : "none"}`,
    "PermitTTY no",
    "ForceCommand /usr/bin/false",
    // T6 (1): forwarding still works with no session at all, and a command is then refused.
    "MaxSessions 0",
    "X11Forwarding no",
    "AllowAgentForwarding no",
    "AllowStreamLocalForwarding no",
    "PermitTunnel no",
    "GatewayPorts no",
    "PermitUserRC no",
    "PermitUserEnvironment no",
    "StrictModes yes",
    "MaxAuthTries 2",
    "LoginGraceTime 20",
    "MaxStartups 3:50:6",
    "ClientAliveInterval 30",
    "ClientAliveCountMax 3",
    "LogLevel VERBOSE",
  ];
  // The tests make many refused logins from 127.0.0.1 on purpose; sshd's own penalty would then shut them out.
  if (loopback) lines.push("PerSourcePenalties no");
  return lines.join("\n") + "\n";
}
