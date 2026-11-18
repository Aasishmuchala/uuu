import AppKit
import EngineShell

// "Engine status": the lines `engine status` printed, as plain text in a fixed-width view (4.4).
@MainActor
final class EngineStatusPanel {
    private let panel: NSPanel
    private let text = NSTextView()

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 680, height: 420),
                        styleMask: [.titled, .closable, .resizable, .utilityWindow],
                        backing: .buffered, defer: true)
        panel.title = NativeWords.engineStatus
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false

        text.isEditable = false
        text.isSelectable = true
        text.isRichText = false
        text.importsGraphics = false
        text.isAutomaticLinkDetectionEnabled = false
        text.isAutomaticDataDetectionEnabled = false
        text.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        text.textContainerInset = NSSize(width: 8, height: 8)
        text.isVerticallyResizable = true
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.setAccessibilityLabel(NativeWords.engineStatus)

        let scroll = NSScrollView()
        scroll.documentView = text
        scroll.hasVerticalScroller = true
        panel.contentView = scroll
        panel.center()
    }

    func show(lines: [String]) {
        text.string = lines.joined(separator: "\n")
        panel.makeKeyAndOrderFront(nil)
    }
}
