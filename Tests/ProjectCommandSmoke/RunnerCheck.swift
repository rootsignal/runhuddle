import AppKit
import SwiftUI
import SessionCore
@MainActor final class ProjectEditorPreferences: ObservableObject {
 static let shared = ProjectEditorPreferences()
 @Published var choices: [ProjectEditor] = []
 func refresh() {}
}
@main struct Check {
 @MainActor static func main() {
  _ = NSApplication.shared
  var runner: ProjectCommandRunner!
  func wait(_ condition: () -> Bool) {
   let until = Date().addingTimeInterval(6)
   while !condition() && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
   if !condition() { print("RUNNER:", runner.output, "running:", runner.running); fflush(stdout) }; precondition(condition(), "Command runner did not reach expected state")
  }
  runner = ProjectCommandRunner()
  runner.run("printf 'command-output'; exit 7", in: "/tmp")
  wait { !runner.running }
  wait { runner.output.contains("command-output") && runner.output.contains("status 7") }
  precondition(ProjectCommandRunner.active.isEmpty)
  runner.run("printf 'ready'; sleep 30", in: "/tmp")
  wait { runner.output.contains("ready") }
  let pid = ProjectCommandRunner.active.keys.first!
  precondition(getpgid(pid) == pid, "Commands must own their process group")
  runner.stop()
  wait { !runner.running }
  precondition(ProjectCommandRunner.active.isEmpty)
  print("Configured command output, exit status, isolated process group, and Stop passed.")
 }
}
