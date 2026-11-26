// App configuration. Nothing secret lives here.

// Public half of the VAPID key pair used for push notifications. The private half is only
// ever stored as the GitHub repo secret VAPID_PRIVATE_KEY. If you replace this key, every
// phone has to turn notifications off and on again and update PUSH_SUBSCRIPTION.
export const VAPID_PUBLIC_KEY = 'BCEFqNILzX1-BCfS0hIO0N2PWeuc50DZ2DxjtnEN0Xqj3l8fMhZ902iFmrQUOndaWw0JQGic0xfsTbR2Ob1Hvc8';

// How many upcoming notification questions to prepare on the device.
export const NOTIFY_QUEUE_SIZE = 30;
