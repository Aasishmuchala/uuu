import EngineShell
import Foundation

// M16: two small modes of this same program, run by the checks as a separate process, so a check can give it
// an environment of its own (M15's M2) or end it by PID in the middle of a run (M15's M4). Never used by the app.
//   engine-mac-checks --print-env              prints EngineEnvironment.forThisUser(), one KEY=value a line
//   engine-mac-checks --run-status <root>      runs `status` on a stand-in root and prints "exit <n>"
//   engine-mac-checks --under-temp <path>      prints "yes" when EngineRoot counts <path> as under a temp folder
func helperMain(_ args: [String]) -> Int32? {
    guard args.count >= 2 else { return nil }
    switch args[1] {
    case "--print-env":
        for (k, v) in EngineEnvironment.forThisUser().sorted(by: { $0.key < $1.key }) { print("\(k)=\(v)") }
        return 0
    case "--run-status":
        guard args.count == 3 else { return 2 }
        let root = URL(fileURLWithPath: args[2], isDirectory: true)
        let done = DispatchSemaphore(value: 0)
        var code: Int32 = -1
        Task.detached {
            code = await EngineCommand.run(.status, root: root).exit
            done.signal()
        }
        done.wait()
        print("exit \(code)")
        return 0
    case "--under-temp":
        guard args.count == 3 else { return 2 }
        print(EngineRoot.isUnderTemp(args[2]) ? "yes" : "no")
        return 0
    default:
        return nil
    }
}
