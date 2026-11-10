import SwiftUI

// Newer SDKs also declare a State macro whose plugin is absent from some
// Command Line Tools packages. Explicitly select the existing property-wrapper
// type, preserving the eager initialization behavior used by this app.
typealias ViewState<Value> = SwiftUI.State<Value>
