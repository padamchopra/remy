#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <Vision/Vision.h>
int main(int argc, const char *argv[]) { @autoreleasepool {
 NSImage *image = [[NSImage alloc] initWithContentsOfFile:@(argv[1])];
 CGRect rect = CGRectMake(0, 0, image.size.width, image.size.height);
 CGImageRef cg = [image CGImageForProposedRect:&rect context:nil hints:nil];
 VNDetectBarcodesRequest *request = [[VNDetectBarcodesRequest alloc] init];
 request.symbologies = @[VNBarcodeSymbologyQR];
 NSError *error = nil;
 VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
 if (![handler performRequests:@[request] error:&error]) return 2;
 NSString *expected = [NSString stringWithContentsOfFile:@(argv[2]) encoding:NSUTF8StringEncoding error:nil];
 for (VNBarcodeObservation *code in request.results) if ([code.payloadStringValue isEqualToString:expected]) { puts("Apple Vision decoded the rendered pairing QR exactly"); return 0; }
 return 1;
} }
