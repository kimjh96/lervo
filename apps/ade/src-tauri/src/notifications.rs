//! Desktop notifications (Lervo ADE sessions, "Live status and notifications"). The interface
//! decides when to notify; the shell shows the notification.
//!
//! On macOS they go through the User Notifications framework, which asks the system for permission
//! at the first notification, as the system expects. The notification plugin answers that
//! permission is granted without asking, so macOS kept Lervo's notifications off and showed none.
//! Elsewhere they go through the plugin.

/// Shows a notification: a workspace title and a catalog message.
#[tauri::command]
pub fn notify(app: tauri::AppHandle, title: String, body: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        apple::show(&title, &body);
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

#[cfg(target_os = "macos")]
mod apple {
    use std::sync::atomic::{AtomicU64, Ordering};

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest,
        UNUserNotificationCenter,
    };

    /// Notifications shown since launch, which names each one so none replaces another.
    static SHOWN: AtomicU64 = AtomicU64::new(0);

    /// Asks for permission, which the system shows once and then answers at once with the user's
    /// choice, and shows the notification when it is granted. While Lervo is the active app the
    /// system adds it to Notification Center without a banner, and the workspace list shows the
    /// same change.
    pub fn show(title: &str, body: &str) {
        let (title, body) = (title.to_owned(), body.to_owned());
        let answered = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            if granted.as_bool() {
                deliver(&title, &body);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert,
                &answered,
            );
    }

    fn deliver(title: &str, body: &str) {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        let identifier = format!("lervo-{}", SHOWN.fetch_add(1, Ordering::Relaxed));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&identifier),
            &content,
            None,
        );
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, None);
    }
}
