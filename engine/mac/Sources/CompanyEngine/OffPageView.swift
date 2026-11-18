import AppKit
import EngineShell

// D11: the page shown when nothing serves the home screen. A native view, so the web view never shows
// anything but the home address (S1). Its words are W2, W3, W4 and one of W5, W8, W10, W16; the engine's
// last lines are plain text in a fixed-width view, never links (4.4).
@MainActor
final class OffPageView: NSView {
    var onStart: (() -> Void)?

    private let title = NSTextField(labelWithString: NativeWords.offTitle)
    private let line = NSTextField(labelWithString: NativeWords.offLine)
    private let button = NSButton(title: NativeWords.start, target: nil, action: nil)
    private let note = NSTextField(wrappingLabelWithString: "")
    private let output = NSTextView()
    private let scroll = NSScrollView()

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 900, height: 600))

        title.font = .systemFont(ofSize: 28, weight: .semibold)
        title.alignment = .center
        title.setAccessibilityRole(.staticText)
        line.font = .systemFont(ofSize: 15)
        line.textColor = .secondaryLabelColor
        line.alignment = .center

        button.bezelStyle = .rounded
        button.controlSize = .large
        button.keyEquivalent = "\r"
        button.target = self
        button.action = #selector(startPressed(_:))
        button.setAccessibilityLabel(NativeWords.start)

        note.font = .systemFont(ofSize: 13)
        note.textColor = .secondaryLabelColor
        note.alignment = .center
        note.preferredMaxLayoutWidth = 520

        output.isEditable = false
        output.isSelectable = true
        output.isRichText = false
        output.importsGraphics = false
        output.usesFindBar = false
        output.isAutomaticLinkDetectionEnabled = false
        output.isAutomaticDataDetectionEnabled = false
        output.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        output.textColor = .secondaryLabelColor
        output.drawsBackground = false
        output.textContainerInset = NSSize(width: 8, height: 8)
        output.isVerticallyResizable = true
        output.autoresizingMask = [.width]
        output.textContainer?.widthTracksTextView = true
        output.setAccessibilityLabel(NativeWords.engineStatus)

        scroll.documentView = output
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.isHidden = true

        let stack = NSStackView(views: [title, line, button, note, scroll])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.setCustomSpacing(24, after: line)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 40),
            stack.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: 40),
            scroll.widthAnchor.constraint(equalToConstant: 640),
            scroll.heightAnchor.constraint(equalToConstant: 220),
            note.widthAnchor.constraint(lessThanOrEqualToConstant: 520),
        ])
    }

    required init?(coder: NSCoder) { nil }

    @objc private func startPressed(_ sender: Any?) { onStart?() }

    func update(_ text: OffPageText, lines: [String]) {
        title.stringValue = text.title
        line.stringValue = text.line
        button.isEnabled = text.startEnabled
        note.stringValue = text.note ?? ""
        note.isHidden = text.note == nil
        output.string = lines.joined(separator: "\n")
        scroll.isHidden = lines.isEmpty
    }
}
