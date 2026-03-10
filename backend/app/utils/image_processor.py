from PIL import Image, ImageDraw
import logging

logger = logging.getLogger(__name__)

class ImageProcessor:
    """Handle image processing and annotation"""
    
    @staticmethod
    def highlight_lbd(image_path, x, y, radius=15, color=(255, 0, 0), outline_width=2):
        """
        Highlight an LBD location on an image
        
        Args:
            image_path: Path to the image
            x: X coordinate
            y: Y coordinate
            radius: Radius of the highlight circle
            color: RGB color tuple
            outline_width: Width of the outline
        
        Returns:
            Path to the annotated image
        """
        try:
            image = Image.open(image_path)
            draw = ImageDraw.Draw(image)
            
            # Draw circle at LBD position
            bbox = [x - radius, y - radius, x + radius, y + radius]
            draw.ellipse(bbox, outline=color, width=outline_width)
            
            return image
        except Exception as e:
            logger.error(f"Error highlighting LBD: {str(e)}")
            raise
    
    @staticmethod
    def draw_lbds_with_status(image_path, lbds_with_status, output_path):
        """
        Draw multiple LBDs on image with their completion status
        
        Args:
            image_path: Path to the source image
            lbds_with_status: List of dicts with 'x', 'y', 'status_color', 'identifier'
            output_path: Path to save the annotated image
        """
        try:
            image = Image.open(image_path)
            draw = ImageDraw.Draw(image)
            
            for lbd in lbds_with_status:
                x = lbd.get('x_position')
                y = lbd.get('y_position')
                color = lbd.get('status_color', (255, 0, 0))
                
                if x is None or y is None:
                    continue
                
                # Draw circle
                radius = 10
                bbox = [x - radius, y - radius, x + radius, y + radius]
                draw.ellipse(bbox, outline=color, width=2)
            
            image.save(output_path, 'PNG')
            return output_path
        
        except Exception as e:
            logger.error(f"Error drawing LBDs on image: {str(e)}")
            raise
