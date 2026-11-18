import Foundation

struct Check {
    let name: String
    let run: () throws -> Void
}

if let code = helperMain(CommandLine.arguments) { exit(code) }

let allChecks: [Check] = webChecks() + engineChecks() + nativeChecks() + scriptChecks()
var failed = 0
for check in allChecks {
    do {
        try check.run()
        print("ok    \(check.name)")
    } catch {
        failed += 1
        print("FAIL  \(check.name): \(error)")
    }
}
print("checks: \(allChecks.count), failed: \(failed)")
exit(failed > 0 ? 1 : 0)
