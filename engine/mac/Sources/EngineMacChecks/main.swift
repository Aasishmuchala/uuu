import Foundation

struct Check {
    let name: String
    let run: () throws -> Void
}

let allChecks: [Check] = webChecks() + engineChecks() + nativeChecks()
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
