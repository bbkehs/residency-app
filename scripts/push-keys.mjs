import webpush from 'web-push';
const keys = webpush.generateVAPIDKeys();
console.log('# Keep the private key in your server environment, not in source control.');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('# Also configure PUSH_ENABLED=true and VAPID_SUBJECT=mailto:your-operator-contact@example.com');
