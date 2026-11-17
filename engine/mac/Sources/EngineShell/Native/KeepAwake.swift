import Foundation
import IOKit.ps
import IOKit.pwr_mgt

// D6: an idle-sleep assertion (the screen may still sleep; a closed lid still sleeps the Mac), held only
// while the engine is on, agents are running, the owner's switch is on, and the Mac is on mains or at 30%
// battery or more. Dropped after two readings in a row with nothing running, when a reading fails, and on quit.
public final class KeepAwake {
    public static let assertionName = "Company Engine: agents are working"

    // 4.6: the rule for one reading.
    public static func hold(engineOn: Bool, running: Int, switchOn: Bool, onMains: Bool, battery: Int) -> Bool {
        engineOn && running > 0 && switchOn && (onMains || battery >= 30)
    }

    private var id: IOPMAssertionID = IOPMAssertionID(0)
    public private(set) var isHeld = false

    public init() {}

    deinit { release() }

    // Holds or lets go; returns whether the assertion is held afterwards.
    @discardableResult
    public func set(_ on: Bool) -> Bool {
        if on { take() } else { release() }
        return isHeld
    }

    public func release() {
        guard isHeld else { return }
        IOPMAssertionRelease(id)
        id = IOPMAssertionID(0)
        isHeld = false
    }

    private func take() {
        guard !isHeld else { return }
        var newID = IOPMAssertionID(0)
        let r = IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep as CFString,
                                            IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                            KeepAwake.assertionName as CFString, &newID)
        if r == kIOReturnSuccess {
            id = newID
            isHeld = true
        }
    }

    // Whether the Mac runs on mains, and its battery in percent (100 with no battery).
    public static func power() -> (onMains: Bool, battery: Int) {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return (true, 100) }
        let source = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?
        let onMains = source != kIOPMBatteryPowerKey
        guard let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else {
            return (onMains, 100)
        }
        for ps in list {
            guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType,
                  let now = d[kIOPSCurrentCapacityKey] as? Int,
                  let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
            return (onMains, Swift.max(0, Swift.min(100, now * 100 / max)))
        }
        return (onMains, 100)
    }
}

// D6 over time: fed one reading per poll, says whether the assertion should be held after it. A reading
// with nothing running keeps a held assertion once; the second in a row lets it go. A failed reading lets
// it go at once.
public struct AwakeRule {
    private var idle = 0

    public init() {}

    public mutating func next(_ state: Poller.State, switchOn: Bool, onMains: Bool, battery: Int,
                              holding: Bool) -> Bool {
        guard case .up(let s) = state else { idle = 0; return false }
        if s.running > 0 {
            idle = 0
            return KeepAwake.hold(engineOn: true, running: s.running, switchOn: switchOn, onMains: onMains, battery: battery)
        }
        idle += 1
        return holding && idle < 2
            && KeepAwake.hold(engineOn: true, running: 1, switchOn: switchOn, onMains: onMains, battery: battery)
    }
}
