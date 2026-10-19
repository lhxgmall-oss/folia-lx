// packaging/macos/desktop-click-guard/main.swift
// folia-desktop-click-guard: macOS wallpaper mode with Stage Manager on (issue #698).
//
// Folia's wallpaper sits below the Finder icons, so a click on it is a click on Finder's desktop,
// and with Stage Manager on that sends the stage aside. Folia's own listen-only tap still forwards
// the click into the wallpaper (electron/wallpaper/macWallpaperController.cjs); this helper only
// keeps Finder from getting it: an active session tap swallows a left-button gesture (down, drags,
// up) that starts on the bare desktop inside the wallpaper's region. Everything else passes
// untouched: clicks on desktop icons and their names, on any window, outside the region, and any
// right button. Measured on macOS 15.3 with Stage Manager on: a swallowed desktop click leaves the
// stage alone, an unswallowed one sends it aside (2026-10-19).
//
// Why a separate process (PR #709 ran the tap in a koffi worker inside Folia): the decision is
// native, never waits on JavaScript; the system drops the tap when this process exits or crashes;
// and Folia starts it only while Stage Manager is on and the desktop icons are shown.
// Fail-open: when a check cannot answer (window list or Accessibility query failing or slow), the
// click passes to Finder as it would without this helper.
//
// Protocol, one line each way. stdin: "region X Y W H" (global points, top-left origin; the
// wallpaper's frame) or "region none". EOF on stdin (Folia gone) ends the helper.
// stdout: "ready", "untrusted" (no Accessibility grant; exits), "tap-failed" (exits).
// With "--prompt" it only asks macOS to show its Accessibility prompt (for Folia, which spawned it,
// so Folia lands in the list) and exits.

import Cocoa

setvbuf(stdout, nil, _IOLBF, 0)
func say(_ line: String) { print(line); fflush(stdout) }

if CommandLine.arguments.contains("--prompt") {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    exit(0)
}

guard AXIsProcessTrusted() else {
    say("untrusted")
    exit(3)
}

// Global top-left points; nil while Folia reports no wallpaper.
var region: CGRect?
let regionLock = NSLock()
func currentRegion() -> CGRect? { regionLock.lock(); defer { regionLock.unlock() }; return region }

let desktopLayer = Int(CGWindowLevelForKey(.desktopIconWindow))
let finderBundle = "com.apple.finder"
let dockBundle = "com.apple.dock"
let ownPid = ProcessInfo.processInfo.processIdentifier

func bundleId(of pid: pid_t) -> String? { NSRunningApplication(processIdentifier: pid)?.bundleIdentifier }

func displayFrame(containing p: CGPoint) -> CGRect? {
    var ids = [CGDirectDisplayID](repeating: 0, count: 8)
    var count: UInt32 = 0
    guard CGGetDisplaysWithPoint(p, 8, &ids, &count) == .success, count > 0 else { return nil }
    return CGDisplayBounds(ids[0])
}

func spansDisplay(_ b: CGRect, _ frame: CGRect?) -> Bool {
    guard let f = frame else { return true }
    let slop: CGFloat = 4
    return b.minX <= f.minX + slop && b.minY <= f.minY + slop && b.maxX >= f.maxX - slop && b.maxY >= f.maxY - slop
}

// Is the topmost surface under the point the bare desktop (Finder's or Stage Manager's full-display
// desktop window)? Same rules as isDesktopPoint in macWallpaperController.cjs: transparent surfaces
// at desktop-adjacent layers and the Dock's full-display tracking surface do not count as covering.
// Folia's own windows above the desktop (its click catchers) do cover: Folia handles those clicks.
func bareDesktopUnder(_ p: CGPoint) -> Bool {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return false }
    let frame = displayFrame(containing: p)
    for w in list {
        guard let layer = w[kCGWindowLayer as String] as? Int, layer >= desktopLayer else { continue }
        guard let bd = w[kCGWindowBounds as String] as? NSDictionary,
              let b = CGRect(dictionaryRepresentation: bd), b.contains(p) else { continue }
        let alpha = w[kCGWindowAlpha as String] as? Double ?? 1
        if layer < 0 && alpha <= 0 { continue }
        let pid = pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0)
        if layer == desktopLayer { return spansDisplay(b, frame) }
        if layer <= 20 && spansDisplay(b, frame) && bundleId(of: pid) == dockBundle { continue }
        return false // an app window, the Dock, a widget or one of Folia's own catchers
    }
    return false
}

// Desktop icon cells (image plus the name under it), refreshed off the event path.
var iconCells: [CGRect] = []
let iconLock = NSLock()
let systemWide = AXUIElementCreateSystemWide()
AXUIElementSetMessagingTimeout(systemWide, 0.05)

func axAttr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
func axFrame(_ e: AXUIElement) -> CGRect? {
    guard let pv = axAttr(e, kAXPositionAttribute), let sv = axAttr(e, kAXSizeAttribute) else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    AXValueGetValue(pv as! AXValue, .cgPoint, &p)
    AXValueGetValue(sv as! AXValue, .cgSize, &s)
    return CGRect(origin: p, size: s)
}

// Finder's desktop is an AXScrollArea spanning a display, holding an AXGroup of AXImage icons (the
// image's frame only). The name below an icon selects it too, so each cell grows to take it in.
func refreshIconCells() {
    guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: finderBundle).first else { return }
    let app = AXUIElementCreateApplication(finder.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.3)
    var cells: [CGRect] = []
    for child in (axAttr(app, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
        guard axAttr(child, kAXRoleAttribute) as? String == kAXScrollAreaRole else { continue }
        for group in (axAttr(child, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
            for icon in (axAttr(group, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
                guard let f = axFrame(icon) else { continue }
                cells.append(CGRect(x: f.minX - 24, y: f.minY - 4, width: f.width + 48, height: f.height + 48))
            }
        }
    }
    iconLock.lock(); iconCells = cells; iconLock.unlock()
}

func onIcon(_ p: CGPoint) -> Bool {
    iconLock.lock(); let cells = iconCells; iconLock.unlock()
    if cells.contains(where: { $0.contains(p) }) { return true }
    // The cache may be a moment old (an icon just moved or appeared): ask Finder directly.
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &element) == .success, let e = element else {
        return true // no answer: let Finder have the click
    }
    let role = axAttr(e, kAXRoleAttribute) as? String
    return role != kAXGroupRole && role != kAXScrollAreaRole
}

// Swallow the gesture if it starts on the bare desktop inside the wallpaper, off any icon.
func shouldSwallow(_ p: CGPoint) -> Bool {
    guard let r = currentRegion(), r.contains(p) else { return false }
    guard bareDesktopUnder(p) else { return false }
    return !onIcon(p)
}

var swallowing = false
var tapPort: CFMachPort?
let mask: CGEventMask = (1 << CGEventType.leftMouseDown.rawValue)
    | (1 << CGEventType.leftMouseUp.rawValue)
    | (1 << CGEventType.leftMouseDragged.rawValue)
let callback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let port = tapPort { CGEvent.tapEnable(tap: port, enable: true) }
    case .leftMouseDown:
        swallowing = shouldSwallow(event.location)
        if swallowing { return nil }
    case .leftMouseDragged:
        if swallowing { return nil }
    case .leftMouseUp:
        if swallowing {
            swallowing = false
            return nil
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

// Tail of the session taps: Folia's listen-only tap (head-inserted) still sees the click first and
// forwards it into the wallpaper; nothing after this tap (Finder) does.
guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .defaultTap,
                                   eventsOfInterest: mask, callback: callback, userInfo: nil) else {
    say("tap-failed")
    exit(4)
}
tapPort = port
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, port, 0), .commonModes)
CGEvent.tapEnable(tap: port, enable: true)

// Icons move, appear and go rarely; a slow refresh off the event path keeps the cells current.
let iconQueue = DispatchQueue(label: "icons", qos: .utility)
func scheduleIconRefresh() {
    iconQueue.asyncAfter(deadline: .now() + 2) {
        if currentRegion() != nil { refreshIconCells() }
        scheduleIconRefresh()
    }
}
iconQueue.async { refreshIconCells() }
scheduleIconRefresh()

// Commands from Folia; EOF means Folia is gone.
Thread.detachNewThread {
    while let line = readLine() {
        let parts = line.split(separator: " ")
        guard parts.first == "region" else { continue }
        let nums = parts.dropFirst().compactMap { Double($0) }
        regionLock.lock()
        region = nums.count == 4 ? CGRect(x: nums[0], y: nums[1], width: nums[2], height: nums[3]) : nil
        regionLock.unlock()
    }
    exit(0)
}

say("ready")
CFRunLoopRun()
