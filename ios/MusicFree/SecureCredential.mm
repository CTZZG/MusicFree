#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

@interface SecureCredential : NSObject <RCTBridgeModule>
@end

@implementation SecureCredential

RCT_EXPORT_MODULE(SecureCredential)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSString *)serviceName
{
  NSString *bundleIdentifier = NSBundle.mainBundle.bundleIdentifier;
  return [NSString stringWithFormat:@"%@.secure-credentials.v1",
                                    bundleIdentifier ?: @"fun.upup.musicfree"];
}

- (BOOL)isValidKey:(NSString *)key
{
  if (key.length == 0 || key.length > 128) {
    return NO;
  }
  NSCharacterSet *allowed =
      [NSCharacterSet characterSetWithCharactersInString:
                          @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"];
  return [key rangeOfCharacterFromSet:allowed.invertedSet].location ==
      NSNotFound;
}

- (NSMutableDictionary *)baseQueryForKey:(NSString *)key
{
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : [self serviceName],
    (__bridge id)kSecAttrAccount : key,
  } mutableCopy];
}

- (void)reject:(RCTPromiseRejectBlock)reject
          code:(NSString *)code
        status:(OSStatus)status
{
  reject(code,
         [NSString stringWithFormat:@"Secure credential operation failed (%d)",
                                    (int)status],
         nil);
}

RCT_EXPORT_METHOD(setCredential:(NSString *)key
                  value:(NSString *)value
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self isValidKey:key] || value.length > 65536) {
    reject(@"E_SECURE_CREDENTIAL_WRITE",
           @"Credential key or value is invalid",
           nil);
    return;
  }

  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableDictionary *query = [self baseQueryForKey:key];
  OSStatus status = SecItemUpdate(
      (__bridge CFDictionaryRef)query,
      (__bridge CFDictionaryRef)@{
        (__bridge id)kSecValueData : data,
      });
  if (status == errSecItemNotFound) {
    query[(__bridge id)kSecValueData] = data;
    query[(__bridge id)kSecAttrAccessible] =
        (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  }
  if (status != errSecSuccess) {
    [self reject:reject code:@"E_SECURE_CREDENTIAL_WRITE" status:status];
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(getCredential:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self isValidKey:key]) {
    reject(@"E_SECURE_CREDENTIAL_READ", @"Credential key is invalid", nil);
    return;
  }

  NSMutableDictionary *query = [self baseQueryForKey:key];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(
      (__bridge CFDictionaryRef)query,
      &result);
  if (status == errSecItemNotFound) {
    resolve(nil);
    return;
  }
  if (status != errSecSuccess) {
    [self reject:reject code:@"E_SECURE_CREDENTIAL_READ" status:status];
    return;
  }

  NSData *data = CFBridgingRelease(result);
  NSString *value = [[NSString alloc] initWithData:data
                                          encoding:NSUTF8StringEncoding];
  if (value == nil) {
    reject(@"E_SECURE_CREDENTIAL_READ",
           @"Secure credential data is invalid",
           nil);
    return;
  }
  resolve(value);
}

RCT_EXPORT_METHOD(hasCredential:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self isValidKey:key]) {
    reject(@"E_SECURE_CREDENTIAL_READ", @"Credential key is invalid", nil);
    return;
  }

  NSMutableDictionary *query = [self baseQueryForKey:key];
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  OSStatus status = SecItemCopyMatching(
      (__bridge CFDictionaryRef)query,
      NULL);
  if (status == errSecItemNotFound) {
    resolve(@NO);
    return;
  }
  if (status != errSecSuccess) {
    [self reject:reject code:@"E_SECURE_CREDENTIAL_READ" status:status];
    return;
  }
  resolve(@YES);
}

RCT_EXPORT_METHOD(deleteCredential:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self isValidKey:key]) {
    reject(@"E_SECURE_CREDENTIAL_DELETE", @"Credential key is invalid", nil);
    return;
  }

  OSStatus status = SecItemDelete(
      (__bridge CFDictionaryRef)[self baseQueryForKey:key]);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    [self reject:reject code:@"E_SECURE_CREDENTIAL_DELETE" status:status];
    return;
  }
  resolve(nil);
}

@end
