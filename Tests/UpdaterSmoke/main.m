#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

// Separate fixture bundle: no RunHuddle stores, bridges, or hook installation.
@interface Driver : NSObject <NSApplicationDelegate, SPUUserDriver>
@property(nonatomic, strong) SPUUpdater *updater;
@end
@implementation Driver
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
    if ([version isEqualToString:@"2"]) {
        NSString *marker = [NSBundle.mainBundle.bundlePath.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"relaunched.txt"];
        [@"Updated and relaunched" writeToFile:marker atomically:YES encoding:NSUTF8StringEncoding error:nil];
        [NSApp terminate:nil]; return;
    }
    self.updater = [[SPUUpdater alloc] initWithHostBundle:NSBundle.mainBundle applicationBundle:NSBundle.mainBundle userDriver:self delegate:nil];
    NSError *error;
    if (![self.updater startUpdater:&error]) { NSLog(@"START ERROR: %@", error); exit(2); }
    [self.updater checkForUpdates];
}
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply { reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]); }
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {}
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply { NSLog(@"FOUND %@", item.versionString); reply(SPUUserUpdateChoiceInstall); }
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement { NSLog(@"NO UPDATE: %@", error); acknowledgement(); exit(3); }
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement { NSLog(@"UPDATE ERROR: %@", error); acknowledgement(); exit(4); }
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate { NSLog(@"EXTRACTING"); }
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply { NSLog(@"INSTALLING"); reply(SPUUserUpdateChoiceInstall); }
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)dismissUpdateInstallation {}
@end
int main(void) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyProhibited];
        Driver *driver = [Driver new]; app.delegate = driver;
        [app run];
    }
    return 0;
}
